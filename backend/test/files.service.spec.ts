import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/routes/auth/auth.service';
import { FilesService } from '../src/routes/files/files.service';
import { WorkspacesService } from '../src/routes/workspaces/workspaces.service';
import { StorageService } from '../src/storage/storage.service';
import {
    createTestDatabase,
    seedUser,
    seedWorkspace,
    type TestDatabase,
} from './helpers/test-database';

describe('FilesService', () => {
    let testDatabase: TestDatabase;
    let filesService: FilesService;
    let storageService: StorageService;
    let workspaceService: WorkspacesService;
    let user: Awaited<ReturnType<typeof seedUser>>;
    let workspaceId: string;
    let storageRoot: string;
    let previousStorageRoot: string | undefined;
    let previousMaxFileSize: string | undefined;

    beforeEach(async () => {
        previousStorageRoot = process.env.STORAGE_ROOT;
        previousMaxFileSize = process.env.MAX_FILE_SIZE_BYTES;
        storageRoot = await mkdtemp(join(tmpdir(), 'fast-drive-files-test-'));
        process.env.STORAGE_ROOT = storageRoot;
        process.env.MAX_FILE_SIZE_BYTES = '1M';

        testDatabase = await createTestDatabase();
        user = await seedUser(testDatabase.db, { nick: 'files-user' });
        ({ workspaceId } = await seedWorkspace(testDatabase.db, user.id, { quotaBytes: 1024 }));
        workspaceService = new WorkspacesService(testDatabase.db, new AuthService(testDatabase.db));
        storageService = new StorageService();
        filesService = new FilesService(testDatabase.db, workspaceService, storageService);
    });

    afterEach(async () => {
        if (previousStorageRoot === undefined) {
            delete process.env.STORAGE_ROOT;
        } else {
            process.env.STORAGE_ROOT = previousStorageRoot;
        }
        if (previousMaxFileSize === undefined) {
            delete process.env.MAX_FILE_SIZE_BYTES;
        } else {
            process.env.MAX_FILE_SIZE_BYTES = previousMaxFileSize;
        }
        await testDatabase.close();
        await rm(storageRoot, { recursive: true, force: true });
    });

    it('creates a folder hierarchy and prevents moving a folder into itself', async () => {
        const root = await filesService.createFolder(user.id, workspaceId, ' Documents ');
        const child = await filesService.createFolder(user.id, workspaceId, 'Invoices', root.id);

        await expect(
            filesService.createFolder(user.id, workspaceId, 'documents'),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            filesService.updateFolder(user.id, root.id, undefined, child.id),
        ).rejects.toBeInstanceOf(BadRequestException);

        const rootListing = await filesService.list(user.id, workspaceId);
        expect(rootListing.folders).toMatchObject([{ id: root.id, name: 'Documents' }]);
        const childListing = await filesService.list(user.id, workspaceId, root.id);
        expect(childListing.folders).toMatchObject([{ id: child.id, parentId: root.id }]);
    });

    it('uploads, lists, downloads and renames files while preserving extensions', async () => {
        const folder = await filesService.createFolder(user.id, workspaceId, 'Reports');
        const sourcePath = join(storageRoot, 'report.txt');
        await writeFile(sourcePath, 'relatório de teste');

        const uploaded = await filesService.upload(
            user.id,
            workspaceId,
            folder.id,
            createUploadedFile(sourcePath, 'relatório.txt', 'text/plain', 19),
        );

        expect(uploaded).toMatchObject({
            originalName: 'relatório.txt',
            extension: '.txt',
            folderId: folder.id,
            size: 19,
        });
        const listing = await filesService.list(user.id, workspaceId, folder.id);
        expect(listing.files).toMatchObject([{ id: uploaded.id, originalName: 'relatório.txt' }]);
        expect(listing.storage.usedBytes).toBe(19);

        const download = await filesService.getDownload(user.id, uploaded.id);
        await expect(readFile(download.path, 'utf8')).resolves.toBe('relatório de teste');
        expect(download.mimeType).toBe('text/plain');

        await expect(
            filesService.updateFile(user.id, uploaded.id, 'renamed.md', undefined, '.md'),
        ).rejects.toBeInstanceOf(BadRequestException);
        const renamed = await filesService.updateFile(
            user.id,
            uploaded.id,
            'renamed',
            null,
            '.txt',
        );
        expect(renamed.originalName).toBe('renamed.txt');
        expect(renamed.folderId).toBeNull();
    });

    it('rolls back the stored file when it would exceed the workspace quota', async () => {
        const tinyWorkspace = await seedWorkspace(testDatabase.db, user.id, {
            name: 'Tiny workspace',
            quotaBytes: 5,
        });
        const sourcePath = join(storageRoot, 'too-large.txt');
        await writeFile(sourcePath, '123456');

        await expect(
            filesService.upload(
                user.id,
                tinyWorkspace.workspaceId,
                undefined,
                createUploadedFile(sourcePath, 'too-large.txt', 'text/plain', 6),
            ),
        ).rejects.toBeInstanceOf(ConflictException);

        await expect(filesService.list(user.id, tinyWorkspace.workspaceId)).resolves.toMatchObject({
            files: [],
            storage: { usedBytes: 0, availableBytes: 5 },
        });
    });

    it('requires recursive confirmation before deleting a non-empty folder', async () => {
        const parent = await filesService.createFolder(user.id, workspaceId, 'Parent');
        const child = await filesService.createFolder(user.id, workspaceId, 'Child', parent.id);
        const sourcePath = join(storageRoot, 'nested.txt');
        await writeFile(sourcePath, 'nested file');
        const uploaded = await filesService.upload(
            user.id,
            workspaceId,
            child.id,
            createUploadedFile(sourcePath, 'nested.txt', 'text/plain', 11),
        );

        await expect(filesService.deleteFolder(user.id, parent.id)).rejects.toBeInstanceOf(
            ConflictException,
        );
        await filesService.deleteFolder(user.id, parent.id, true);

        await expect(filesService.listFolders(user.id, workspaceId)).resolves.toEqual([]);
        await expect(filesService.getDownload(user.id, uploaded.id)).rejects.toBeInstanceOf(
            NotFoundException,
        );
        expect(() =>
            storageService.resolveStoredPath(`workspaces/${workspaceId}/files/${uploaded.id}`),
        ).toThrow(NotFoundException);
    });

    it('does not allow moving a file into a folder from another workspace', async () => {
        const otherWorkspace = await seedWorkspace(testDatabase.db, user.id, {
            name: 'Other workspace',
            quotaBytes: 1024,
        });
        const foreignFolder = await filesService.createFolder(
            user.id,
            otherWorkspace.workspaceId,
            'Foreign',
        );
        const sourcePath = join(storageRoot, 'cross-workspace.txt');
        await writeFile(sourcePath, 'cross workspace');
        const uploaded = await filesService.upload(
            user.id,
            workspaceId,
            undefined,
            createUploadedFile(sourcePath, 'cross-workspace.txt', 'text/plain', 15),
        );

        await expect(
            filesService.updateFile(user.id, uploaded.id, undefined, foreignFolder.id),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

function createUploadedFile(
    path: string,
    originalname: string,
    mimetype: string,
    size: number,
): Express.Multer.File {
    return {
        fieldname: 'file',
        originalname,
        encoding: '7bit',
        mimetype,
        size,
        destination: '',
        filename: originalname,
        path,
        buffer: Buffer.alloc(0),
    } as Express.Multer.File;
}
