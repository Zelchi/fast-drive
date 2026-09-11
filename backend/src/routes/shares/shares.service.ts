import { randomBytes, randomUUID } from 'node:crypto';
import type { PublicShareMetadata } from '@fast-drive/file-models';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type Database, DRIZZLE_DB } from '../../db/database.module';
import { fileShares, files } from '../../db/schema';
import { StorageService } from '../../storage/storage.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { getSafePublicContentType } from './public-content';

export interface FileShareSummary {
    fileId: string;
    token: string;
    isPublic: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface PublicFileDownload {
    path: string;
    originalName: string;
    mimeType: string;
    size: number;
}

@Injectable()
export class SharesService {
    constructor(
        @Inject(DRIZZLE_DB) private readonly db: Database,
        private readonly storageService: StorageService,
        private readonly workspacesService: WorkspacesService,
    ) {}

    async getForUser(userId: string, fileId: string): Promise<FileShareSummary> {
        const file = await this.requireFile(fileId);
        await this.workspacesService.requireMembership(userId, file.workspaceId);
        return this.toSummary(await this.ensureShare(file.id, userId));
    }

    async updateForUser(
        userId: string,
        fileId: string,
        isPublic: boolean,
    ): Promise<FileShareSummary> {
        const file = await this.requireFile(fileId);
        await this.workspacesService.requireMembership(userId, file.workspaceId);
        const share = await this.ensureShare(file.id, userId);
        const updatedAt = new Date();
        await this.db
            .update(fileShares)
            .set({ isPublic, updatedAt })
            .where(eq(fileShares.id, share.id))
            .run();
        return this.toSummary({ ...share, isPublic, updatedAt });
    }

    async getPublicMetadata(token: string): Promise<PublicShareMetadata> {
        const normalizedToken = token.trim();
        const share = await this.db
            .select()
            .from(fileShares)
            .where(and(eq(fileShares.token, normalizedToken), eq(fileShares.isPublic, true)))
            .get();
        if (!share) {
            throw new NotFoundException('Link de compartilhamento não encontrado.');
        }

        const file = await this.db.select().from(files).where(eq(files.id, share.fileId)).get();
        if (!file) {
            throw new NotFoundException('Arquivo compartilhado não encontrado.');
        }

        return {
            fileId: file.id,
            token: share.token,
            originalName: file.originalName,
            extension: file.extension,
            mimeType: getSafePublicContentType(file.mimeType).mimeType,
            size: file.size,
            createdAt: share.createdAt.toISOString(),
            updatedAt: share.updatedAt.toISOString(),
        };
    }

    async getPublicFile(token: string): Promise<PublicFileDownload> {
        const normalizedToken = token.trim();
        const share = await this.db
            .select()
            .from(fileShares)
            .where(and(eq(fileShares.token, normalizedToken), eq(fileShares.isPublic, true)))
            .get();
        if (!share) {
            throw new NotFoundException('Link de compartilhamento não encontrado.');
        }

        const file = await this.db.select().from(files).where(eq(files.id, share.fileId)).get();
        if (!file) {
            throw new NotFoundException('Arquivo compartilhado não encontrado.');
        }

        return {
            path: this.storageService.resolveStoredPath(file.storagePath),
            originalName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
        };
    }

    private async ensureShare(fileId: string, userId: string) {
        const existing = await this.db
            .select()
            .from(fileShares)
            .where(eq(fileShares.fileId, fileId))
            .get();
        if (existing) {
            return existing;
        }

        const now = new Date();
        const share = {
            id: randomUUID(),
            fileId,
            token: randomBytes(32).toString('base64url'),
            isPublic: false,
            createdById: userId,
            createdAt: now,
            updatedAt: now,
        };
        try {
            await this.db.insert(fileShares).values(share).run();
            return share;
        } catch (error: unknown) {
            const concurrentShare = await this.db
                .select()
                .from(fileShares)
                .where(eq(fileShares.fileId, fileId))
                .get();
            if (concurrentShare) {
                return concurrentShare;
            }
            throw error;
        }
    }

    private async requireFile(fileId: string) {
        const file = await this.db.select().from(files).where(eq(files.id, fileId)).get();
        if (!file) {
            throw new NotFoundException('Arquivo não encontrado.');
        }
        return file;
    }

    private toSummary(share: typeof fileShares.$inferSelect): FileShareSummary {
        return {
            fileId: share.fileId,
            token: share.token,
            isPublic: share.isPublic,
            createdAt: share.createdAt,
            updatedAt: share.updatedAt,
        };
    }
}
