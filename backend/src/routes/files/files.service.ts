import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Database, DRIZZLE_DB } from '../../db/database.module';
import { files, folders, workspaces } from '../../db/schema';
import { StorageService } from '../../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { getMaxFileSize } from './file-size';

export interface FolderSummary {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface FileSummary {
    id: string;
    originalName: string;
    extension: string;
    mimeType: string;
    size: number;
    folderId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

@Injectable()
export class FilesService {
    private readonly maxFileSize = getMaxFileSize();
    private readonly uploadLocks = new Map<string, Promise<void>>();

    constructor(
        @Inject(DRIZZLE_DB) private readonly db: Database,
        private readonly workspacesService: WorkspacesService,
        private readonly storageService: StorageService,
    ) {}

    async list(
        userId: string,
        workspaceId: string,
        folderId?: string,
    ): Promise<{
        workspaceId: string;
        folderId: string | null;
        folders: FolderSummary[];
        files: FileSummary[];
        storage: {
            quotaBytes: number;
            usedBytes: number;
            availableBytes: number;
        };
    }> {
        const workspace = await this.workspacesService.requireMembership(userId, workspaceId);
        const folderCondition = folderId
            ? eq(folders.parentId, folderId)
            : isNull(folders.parentId);
        const fileCondition = folderId ? eq(files.folderId, folderId) : isNull(files.folderId);
        if (folderId) {
            await this.requireFolderInWorkspace(folderId, workspaceId);
        }

        const [folderRecords, fileRecords] = await Promise.all([
            this.db
                .select()
                .from(folders)
                .where(and(eq(folders.workspaceId, workspaceId), folderCondition))
                .orderBy(folders.name)
                .all(),
            this.db
                .select()
                .from(files)
                .where(and(eq(files.workspaceId, workspaceId), fileCondition))
                .orderBy(files.originalName)
                .all(),
        ]);

        return {
            workspaceId,
            folderId: folderId ?? null,
            folders: folderRecords.map((folder) => this.toFolderSummary(folder)),
            files: fileRecords.map((file) => this.toFileSummary(file)),
            storage: {
                quotaBytes: workspace.quotaBytes,
                usedBytes: workspace.usedBytes,
                availableBytes: workspace.availableBytes,
            },
        };
    }

    async listFolders(userId: string, workspaceId: string): Promise<FolderSummary[]> {
        await this.workspacesService.requireMembership(userId, workspaceId);
        const folderRecords = await this.db
            .select()
            .from(folders)
            .where(eq(folders.workspaceId, workspaceId))
            .orderBy(folders.name)
            .all();
        return folderRecords.map((folder) => this.toFolderSummary(folder));
    }

    async createFolder(
        userId: string,
        workspaceId: string,
        nameInput: string,
        parentIdInput?: string | null,
    ): Promise<FolderSummary> {
        await this.workspacesService.requireMembership(userId, workspaceId);
        const name = this.validateName(nameInput, 'pasta');
        const parentId = parentIdInput?.trim() || null;
        if (parentId) {
            await this.requireFolderInWorkspace(parentId, workspaceId);
        }
        await this.ensureSiblingNameAvailable(workspaceId, parentId, name);
        const now = new Date();
        const folder = {
            id: randomUUID(),
            workspaceId,
            parentId,
            name,
            createdById: userId,
            createdAt: now,
            updatedAt: now,
        };
        await this.db.insert(folders).values(folder).run();
        return this.toFolderSummary(folder);
    }

    async updateFolder(
        userId: string,
        folderId: string,
        nameInput?: string,
        parentIdInput?: string | null,
    ): Promise<FolderSummary> {
        const folder = await this.requireFolder(folderId);
        await this.workspacesService.requireMembership(userId, folder.workspaceId);
        const name = nameInput === undefined ? folder.name : this.validateName(nameInput, 'pasta');
        const parentId =
            parentIdInput === undefined ? folder.parentId : parentIdInput?.trim() || null;
        if (parentId) {
            await this.requireFolderInWorkspace(parentId, folder.workspaceId);
            if (parentId === folder.id || (await this.isDescendant(parentId, folder.id))) {
                throw new BadRequestException(
                    'Uma pasta não pode ser movida para dentro dela mesma.',
                );
            }
        }
        if (name !== folder.name || parentId !== folder.parentId) {
            await this.ensureSiblingNameAvailable(folder.workspaceId, parentId, name, folder.id);
        }
        const updatedAt = new Date();
        await this.db
            .update(folders)
            .set({ name, parentId, updatedAt })
            .where(eq(folders.id, folder.id))
            .run();
        return this.toFolderSummary({ ...folder, name, parentId, updatedAt });
    }

    async deleteFolder(userId: string, folderId: string, recursive = false): Promise<void> {
        const folder = await this.requireFolder(folderId);
        await this.workspacesService.requireMembership(userId, folder.workspaceId);

        if (recursive) {
            const folderRecords = await this.db
                .select({ id: folders.id, parentId: folders.parentId })
                .from(folders)
                .where(eq(folders.workspaceId, folder.workspaceId))
                .all();
            const folderIds = new Set([folder.id]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const childFolder of folderRecords) {
                    if (
                        childFolder.parentId &&
                        folderIds.has(childFolder.parentId) &&
                        !folderIds.has(childFolder.id)
                    ) {
                        folderIds.add(childFolder.id);
                        changed = true;
                    }
                }
            }

            const folderIdList = [...folderIds];
            const fileRecords = await this.db
                .select({ id: files.id, storagePath: files.storagePath })
                .from(files)
                .where(
                    and(
                        eq(files.workspaceId, folder.workspaceId),
                        inArray(files.folderId, folderIdList),
                    ),
                )
                .all();
            await Promise.all(
                fileRecords.map((file) => this.storageService.remove(file.storagePath)),
            );

            await this.db.transaction(async (tx) => {
                if (fileRecords.length > 0) {
                    await tx
                        .delete(files)
                        .where(
                            inArray(
                                files.id,
                                fileRecords.map((file) => file.id),
                            ),
                        )
                        .run();
                }
                await tx.delete(folders).where(inArray(folders.id, folderIdList)).run();
            });
            return;
        }

        const [childFolder, childFile] = await Promise.all([
            this.db
                .select({ id: folders.id })
                .from(folders)
                .where(eq(folders.parentId, folder.id))
                .get(),
            this.db.select({ id: files.id }).from(files).where(eq(files.folderId, folder.id)).get(),
        ]);
        if (childFolder || childFile) {
            throw new ConflictException('A pasta precisa estar vazia para ser excluída.');
        }
        await this.db.delete(folders).where(eq(folders.id, folder.id)).run();
    }

    async upload(
        userId: string,
        workspaceId: string,
        folderId: string | undefined,
        uploadedFile: Express.Multer.File,
    ): Promise<FileSummary> {
        await this.workspacesService.requireMembership(userId, workspaceId);
        if (!uploadedFile?.path) {
            throw new BadRequestException('Envie um arquivo no campo "file".');
        }
        const fileSize = uploadedFile.size;
        if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
            throw new BadRequestException('O tamanho do arquivo é inválido.');
        }
        if (fileSize > this.maxFileSize) {
            throw new BadRequestException(
                `O arquivo excede o limite de ${this.maxFileSize} bytes.`,
            );
        }

        return this.withUploadLock(workspaceId, async () => {
            const workspace = await this.workspacesService.requireMembership(userId, workspaceId);
            if (fileSize > workspace.availableBytes) {
                throw new ConflictException(
                    'O arquivo excede o espaço disponível neste workspace.',
                );
            }
            const normalizedFolderId = folderId?.trim() || null;
            if (normalizedFolderId) {
                await this.requireFolderInWorkspace(normalizedFolderId, workspaceId);
            }

            const originalName = this.validateFileName(uploadedFile.originalname);
            const extension = this.getFileExtension(originalName);
            const now = new Date();
            const fileId = randomUUID();
            const storedName = fileId;
            const storagePath = await this.storageService.saveFromPath(
                workspaceId,
                storedName,
                uploadedFile.path,
            );
            const file = {
                id: fileId,
                workspaceId,
                folderId: normalizedFolderId,
                originalName,
                extension,
                storedName,
                mimeType: uploadedFile.mimetype || 'application/octet-stream',
                size: fileSize,
                storagePath,
                uploadedById: userId,
                createdAt: now,
                updatedAt: now,
            };

            try {
                await this.db.transaction(async (tx) => {
                    const currentWorkspace = await tx
                        .select({ quotaBytes: workspaces.quotaBytes })
                        .from(workspaces)
                        .where(eq(workspaces.id, workspaceId))
                        .get();
                    const usage = await tx
                        .select({ usedBytes: sql<number>`coalesce(sum(${files.size}), 0)` })
                        .from(files)
                        .where(eq(files.workspaceId, workspaceId))
                        .get();
                    const usedBytes = Number(usage?.usedBytes ?? 0);
                    if (
                        !currentWorkspace ||
                        fileSize > Math.max(currentWorkspace.quotaBytes - usedBytes, 0)
                    ) {
                        throw new ConflictException(
                            'O arquivo excede o espaço disponível neste workspace.',
                        );
                    }
                    await tx.insert(files).values(file).run();
                });
            } catch (error) {
                await this.storageService.remove(storagePath);
                throw error;
            }
            return this.toFileSummary(file);
        });
    }

    async getDownload(
        userId: string,
        fileId: string,
    ): Promise<{
        path: string;
        originalName: string;
        mimeType: string;
    }> {
        const file = await this.requireFile(fileId);
        await this.workspacesService.requireMembership(userId, file.workspaceId);
        return {
            path: this.storageService.resolveStoredPath(file.storagePath),
            originalName: file.originalName,
            mimeType: file.mimeType,
        };
    }

    async updateFile(
        userId: string,
        fileId: string,
        nameInput?: string,
        folderIdInput?: string | null,
        extensionInput?: string,
    ): Promise<FileSummary> {
        const file = await this.requireFile(fileId);
        await this.workspacesService.requireMembership(userId, file.workspaceId);
        const extension = file.extension || this.getFileExtension(file.originalName);
        if (extensionInput !== undefined && extensionInput !== extension) {
            throw new BadRequestException('A extensão do arquivo não pode ser alterada.');
        }
        if (!extension && nameInput !== undefined && this.getFileExtension(nameInput)) {
            throw new BadRequestException(
                'Este arquivo não possui extensão e não pode receber uma nova extensão.',
            );
        }
        const baseName =
            nameInput === undefined
                ? this.removeExtension(file.originalName, extension)
                : this.validateFileName(nameInput);
        const originalName =
            nameInput === undefined ? file.originalName : `${baseName}${extension}`;
        const folderId =
            folderIdInput === undefined ? file.folderId : folderIdInput?.trim() || null;
        if (folderId) {
            await this.requireFolderInWorkspace(folderId, file.workspaceId);
        }
        const updatedAt = new Date();
        await this.db
            .update(files)
            .set({ originalName, extension, folderId, updatedAt })
            .where(eq(files.id, file.id))
            .run();
        return this.toFileSummary({ ...file, originalName, extension, folderId, updatedAt });
    }

    async deleteFile(userId: string, fileId: string): Promise<void> {
        const file = await this.requireFile(fileId);
        await this.workspacesService.requireMembership(userId, file.workspaceId);
        await this.storageService.remove(file.storagePath);
        await this.db.delete(files).where(eq(files.id, file.id)).run();
    }

    async reconcileStorage(): Promise<number> {
        const records = await this.db.select({ storagePath: files.storagePath }).from(files).all();
        return this.storageService.reconcile(records.map((record) => record.storagePath));
    }

    private async requireFolder(folderId: string) {
        const folder = await this.db.select().from(folders).where(eq(folders.id, folderId)).get();
        if (!folder) {
            throw new NotFoundException('Pasta não encontrada.');
        }
        return folder;
    }

    private async requireFolderInWorkspace(folderId: string, workspaceId: string) {
        const folder = await this.requireFolder(folderId);
        if (folder.workspaceId !== workspaceId) {
            throw new NotFoundException('Pasta não encontrada.');
        }
        return folder;
    }

    private async requireFile(fileId: string) {
        const file = await this.db.select().from(files).where(eq(files.id, fileId)).get();
        if (!file) {
            throw new NotFoundException('Arquivo não encontrado.');
        }
        return file;
    }

    private async ensureSiblingNameAvailable(
        workspaceId: string,
        parentId: string | null,
        name: string,
        ignoredId?: string,
    ): Promise<void> {
        const condition = parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId);
        const siblings = await this.db
            .select()
            .from(folders)
            .where(and(eq(folders.workspaceId, workspaceId), condition))
            .all();
        if (
            siblings.some(
                (folder) =>
                    folder.id !== ignoredId && folder.name.toLowerCase() === name.toLowerCase(),
            )
        ) {
            throw new ConflictException('Já existe uma pasta com esse nome neste local.');
        }
    }

    private async isDescendant(candidateParentId: string, folderId: string): Promise<boolean> {
        let current = await this.requireFolder(candidateParentId);
        while (current.parentId) {
            if (current.parentId === folderId) {
                return true;
            }
            current = await this.requireFolder(current.parentId);
        }
        return false;
    }

    private validateName(value: string, subject: string): string {
        const name = value.trim();
        const hasControlCharacter = [...name].some((character) => {
            const code = character.charCodeAt(0);
            return code <= 0x1f || code === 0x7f;
        });
        if (
            !name ||
            name.length > 255 ||
            name === '.' ||
            name === '..' ||
            name.includes('\\') ||
            name.includes('/') ||
            hasControlCharacter
        ) {
            throw new BadRequestException(`Nome de ${subject} inválido.`);
        }
        return name;
    }

    private validateFileName(value: string): string {
        const name = this.validateName(value, 'arquivo');
        if (name.includes('..')) {
            throw new BadRequestException('Nome de arquivo inválido.');
        }
        return name;
    }

    private getFileExtension(value: string): string {
        const extension = extname(value);
        return extension === '.' ? '' : extension;
    }

    private removeExtension(value: string, extension: string): string {
        return extension && value.endsWith(extension) ? value.slice(0, -extension.length) : value;
    }

    private toFolderSummary(folder: typeof folders.$inferSelect): FolderSummary {
        return {
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            createdAt: folder.createdAt,
            updatedAt: folder.updatedAt,
        };
    }

    private toFileSummary(file: typeof files.$inferSelect): FileSummary {
        return {
            id: file.id,
            originalName: file.originalName,
            extension: file.extension || this.getFileExtension(file.originalName),
            mimeType: file.mimeType,
            size: file.size,
            folderId: file.folderId,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
        };
    }

    private async withUploadLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.uploadLocks.get(workspaceId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.uploadLocks.set(workspaceId, current);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.uploadLocks.get(workspaceId) === current) {
                this.uploadLocks.delete(workspaceId);
            }
        }
    }
}
