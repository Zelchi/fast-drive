import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { files } from '../src/db/schema';
import { SharesService } from '../src/routes/shares/shares.service';
import { WorkspacesService } from '../src/routes/workspaces/workspaces.service';
import { StorageService } from '../src/storage/storage.service';
import {
    createTestDatabase,
    seedUser,
    seedWorkspace,
    type TestDatabase,
} from './helpers/test-database';

describe('SharesService', () => {
    let testDatabase: TestDatabase;
    let sharesService: SharesService;
    let storageService: StorageService;
    let workspaceService: WorkspacesService;
    let userId: string;
    let workspaceId: string;
    let fileId: string;

    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        const user = await seedUser(testDatabase.db, { nick: 'shares-user' });
        userId = user.id;
        ({ workspaceId } = await seedWorkspace(testDatabase.db, userId));
        fileId = randomUUID();
        const now = new Date();
        await testDatabase.db
            .insert(files)
            .values({
                id: fileId,
                workspaceId,
                folderId: null,
                originalName: 'manual.pdf',
                extension: '.pdf',
                storedName: fileId,
                mimeType: 'application/pdf',
                size: 42,
                storagePath: `workspaces/${workspaceId}/files/${fileId}`,
                uploadedById: userId,
                createdAt: now,
                updatedAt: now,
            })
            .run();

        storageService = {
            resolveStoredPath: vi.fn().mockReturnValue('/tmp/manual.pdf'),
        } as unknown as StorageService;
        workspaceService = {
            requireMembership: vi.fn().mockResolvedValue({
                id: workspaceId,
                name: 'Workspace de teste',
                role: 'OWNER',
                quotaBytes: 1024,
                usedBytes: 42,
                availableBytes: 982,
                createdAt: new Date(),
                updatedAt: new Date(),
            }),
        } as unknown as WorkspacesService;
        sharesService = new SharesService(testDatabase.db, storageService, workspaceService);
    });

    afterEach(async () => {
        await testDatabase.close();
    });

    it('creates one private share, enables it and serves sanitized public metadata', async () => {
        const privateShare = await sharesService.getForUser(userId, fileId);
        expect(privateShare.isPublic).toBe(false);

        const sameShare = await sharesService.getForUser(userId, fileId);
        expect(sameShare.token).toBe(privateShare.token);

        await expect(sharesService.getPublicMetadata(privateShare.token)).rejects.toBeInstanceOf(
            NotFoundException,
        );

        const publicShare = await sharesService.updateForUser(userId, fileId, true);
        expect(publicShare).toMatchObject({ fileId, token: privateShare.token, isPublic: true });

        const metadata = await sharesService.getPublicMetadata(` ${publicShare.token} `);
        expect(metadata).toMatchObject({
            fileId,
            originalName: 'manual.pdf',
            extension: '.pdf',
            mimeType: 'application/pdf',
            size: 42,
        });
        const publicFile = await sharesService.getPublicFile(publicShare.token);
        expect(publicFile).toEqual({
            path: '/tmp/manual.pdf',
            originalName: 'manual.pdf',
            mimeType: 'application/pdf',
            size: 42,
        });
        expect(storageService.resolveStoredPath).toHaveBeenCalledWith(
            `workspaces/${workspaceId}/files/${fileId}`,
        );

        await sharesService.updateForUser(userId, fileId, false);
        await expect(sharesService.getPublicFile(publicShare.token)).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });

    it('does not expose unsafe content types as inline public metadata', async () => {
        const share = await sharesService.updateForUser(userId, fileId, true);
        await testDatabase.db
            .update(files)
            .set({ mimeType: 'text/html; charset=utf-8' })
            .where(eq(files.id, fileId))
            .run();

        await expect(sharesService.getPublicMetadata(share.token)).resolves.toMatchObject({
            mimeType: 'application/octet-stream',
        });
    });

    it('checks workspace membership before creating or changing a share', async () => {
        const deniedWorkspaceService = {
            requireMembership: vi.fn().mockRejectedValue(new ForbiddenException('sem acesso')),
        } as unknown as WorkspacesService;
        const deniedSharesService = new SharesService(
            testDatabase.db,
            storageService,
            deniedWorkspaceService,
        );

        await expect(deniedSharesService.getForUser('other-user', fileId)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(
            deniedSharesService.updateForUser('other-user', fileId, true),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(deniedWorkspaceService.requireMembership).toHaveBeenCalledTimes(2);
    });
});
