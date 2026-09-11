import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { files } from '../src/db/schema';
import { AuthService } from '../src/routes/auth/auth.service';
import { WorkspacesService } from '../src/routes/workspaces/workspaces.service';
import {
    createTestDatabase,
    seedUser,
    seedWorkspace,
    type TestDatabase,
} from './helpers/test-database';

describe('WorkspacesService', () => {
    let testDatabase: TestDatabase;
    let workspacesService: WorkspacesService;

    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        workspacesService = new WorkspacesService(
            testDatabase.db,
            new AuthService(testDatabase.db),
        );
    });

    afterEach(async () => {
        await testDatabase.close();
    });

    it('creates and renames a workspace for an owner', async () => {
        const owner = await seedUser(testDatabase.db, { nick: 'workspace-owner' });
        await seedWorkspace(testDatabase.db, owner.id, {
            name: 'Existing workspace',
            quotaBytes: 1024,
        });

        const created = await workspacesService.create(owner.id, '  Projetos  ', '512M');
        expect(created.name).toBe('Projetos');
        expect(created.role).toBe('OWNER');
        expect(created.quotaBytes).toBe(512 * 1024 ** 2);
        expect(created.usedBytes).toBe(0);
        expect(created.availableBytes).toBe(created.quotaBytes);

        const renamed = await workspacesService.updateName(owner.id, created.id, '  Arquivos  ');
        expect(renamed.name).toBe('Arquivos');
        await expect(
            workspacesService.updateName(owner.id, created.id, '   '),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not allow a member to create or update a workspace', async () => {
        const owner = await seedUser(testDatabase.db, { nick: 'workspace-owner' });
        const member = await seedUser(testDatabase.db, { nick: 'workspace-member' });
        const { workspaceId } = await seedWorkspace(testDatabase.db, owner.id);
        await workspacesService.addMember(owner.id, workspaceId, member.id, '');

        await expect(workspacesService.create(member.id, 'Nope', '1M')).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(
            workspacesService.updateName(member.id, workspaceId, 'Nope'),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
            workspacesService.requireMembership(member.id, workspaceId),
        ).resolves.toMatchObject({
            role: 'MEMBER',
        });
    });

    it('never lets a quota become smaller than the used space', async () => {
        const owner = await seedUser(testDatabase.db, { nick: 'quota-owner' });
        const { workspaceId } = await seedWorkspace(testDatabase.db, owner.id, {
            quotaBytes: 1000,
        });
        const now = new Date();
        await testDatabase.db
            .insert(files)
            .values({
                id: randomUUID(),
                workspaceId,
                folderId: null,
                originalName: 'large.bin',
                extension: '.bin',
                storedName: randomUUID(),
                mimeType: 'application/octet-stream',
                size: 600,
                storagePath: `workspaces/${workspaceId}/files/large.bin`,
                uploadedById: owner.id,
                createdAt: now,
                updatedAt: now,
            })
            .run();

        const membership = await workspacesService.requireMembership(owner.id, workspaceId);
        expect(membership.usedBytes).toBe(600);
        expect(membership.availableBytes).toBe(400);
        await expect(
            workspacesService.updateQuota(owner.id, workspaceId, '500B'),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects allocations that exceed the total storage quota', async () => {
        const owner = await seedUser(testDatabase.db, { nick: 'storage-owner' });
        await seedWorkspace(testDatabase.db, owner.id, {
            quotaBytes: 9 * 1024 ** 3,
        });

        await expect(workspacesService.create(owner.id, 'Too large', '2G')).rejects.toBeInstanceOf(
            ConflictException,
        );

        const overview = await workspacesService.getStorageOverview();
        expect(overview.allocatedBytes).toBe(9 * 1024 ** 3);
        expect(overview.availableBytes).toBe(1024 ** 3);
    });

    it('adds, lists and removes members while protecting the owner', async () => {
        const owner = await seedUser(testDatabase.db, { nick: 'members-owner' });
        const member = await seedUser(testDatabase.db, { nick: 'members-user' });
        const inactive = await seedUser(testDatabase.db, {
            nick: 'inactive-user',
            isActive: false,
        });
        const { workspaceId } = await seedWorkspace(testDatabase.db, owner.id);

        const added = await workspacesService.addMember(owner.id, workspaceId, '', member.nick);
        expect(added).toMatchObject({ userId: member.id, nick: member.nick, role: 'MEMBER' });
        await expect(
            workspacesService.addMember(owner.id, workspaceId, member.id, ''),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            workspacesService.addMember(owner.id, workspaceId, inactive.id, ''),
        ).rejects.toBeInstanceOf(BadRequestException);

        const members = await workspacesService.listMembers(owner.id, workspaceId);
        expect(members.map((item) => item.nick)).toEqual(['members-owner', 'members-user']);

        await expect(
            workspacesService.removeMember(owner.id, workspaceId, owner.id),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await workspacesService.removeMember(owner.id, workspaceId, member.id);
        await expect(workspacesService.listMembers(owner.id, workspaceId)).resolves.toHaveLength(1);
    });

    it('only returns workspaces where the user has a membership', async () => {
        const owner = await seedUser(testDatabase.db, { nick: 'list-owner' });
        const member = await seedUser(testDatabase.db, { nick: 'list-member' });
        const first = await seedWorkspace(testDatabase.db, owner.id, {
            name: 'Z workspace',
            quotaBytes: 100,
        });
        const second = await seedWorkspace(testDatabase.db, owner.id, {
            name: 'A workspace',
            quotaBytes: 200,
        });
        await workspacesService.addMember(owner.id, first.workspaceId, member.id, '');

        const result = await workspacesService.listForUser(member.id);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: first.workspaceId,
            name: 'Z workspace',
            role: 'MEMBER',
            quotaBytes: 100,
        });
        expect(result.some((workspace) => workspace.id === second.workspaceId)).toBe(false);
    });
});
