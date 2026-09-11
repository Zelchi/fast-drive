import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessions } from '../src/db/schema';
import { hashSessionToken } from '../src/routes/auth/auth.crypto';
import { AuthService } from '../src/routes/auth/auth.service';
import {
    createTestDatabase,
    seedUser,
    seedWorkspace,
    type TestDatabase,
} from './helpers/test-database';

describe('AuthService', () => {
    let testDatabase: TestDatabase;
    let authService: AuthService;

    beforeEach(async () => {
        testDatabase = await createTestDatabase();
        authService = new AuthService(testDatabase.db);
    });

    afterEach(async () => {
        await testDatabase.close();
    });

    it('creates a user and completes the first-access password flow', async () => {
        const created = await authService.createUser('  Alice_01  ');

        expect(created.user.nick).toBe('alice_01');
        expect(created.user.mustCreatePassword).toBe(true);
        expect(created.serial).toMatch(/^FD-[A-F0-9]{36}$/);

        const firstAccessError = await authService
            .loginAutomatically(created.user.nick, created.serial)
            .catch((error: unknown) => error);
        expect(firstAccessError).toBeInstanceOf(ForbiddenException);
        expect((firstAccessError as ForbiddenException).getResponse()).toMatchObject({
            code: 'FIRST_ACCESS_REQUIRED',
        });

        const authenticated = await authService.firstAccess(
            'ALICE_01',
            created.serial,
            'first-password',
        );
        expect(authenticated.user.mustCreatePassword).toBe(false);
        await expect(authService.getSession(authenticated.token)).resolves.toMatchObject({
            user: { id: created.user.id, nick: 'alice_01' },
        });

        const passwordLogin = await authService.loginWithPassword('alice_01', 'first-password');
        expect(passwordLogin.user.id).toBe(created.user.id);
    });

    it('rejects invalid nick, password and credentials at the service boundary', async () => {
        await expect(authService.createUser('ab')).rejects.toBeInstanceOf(BadRequestException);
        await expect(authService.createUser('invalid nick')).rejects.toBeInstanceOf(
            BadRequestException,
        );
        await expect(authService.loginAutomatically('valid-user', '   ')).rejects.toBeInstanceOf(
            BadRequestException,
        );

        const created = await authService.createUser('valid-user');
        await expect(
            authService.firstAccess(created.user.nick, created.serial, 'short'),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            authService.loginWithPassword(created.user.nick, 'wrong-password'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('updates the profile, avatar and password only with the current password', async () => {
        const created = await authService.createUser('profile-user');
        await authService.firstAccess(created.user.nick, created.serial, 'old-password');

        await expect(
            authService.updateProfile(created.user.id, {
                displayName: '  Ana Maria  ',
                currentPassword: 'incorrect-password',
                newPassword: 'new-password',
            }),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        const updated = await authService.updateProfile(created.user.id, {
            displayName: '  Ana Maria  ',
            currentPassword: 'old-password',
            newPassword: 'new-password',
        });
        expect(updated.displayName).toBe('Ana Maria');

        const withAvatar = await authService.updateAvatar(
            created.user.id,
            'data:image/png;base64,WA==',
        );
        expect(withAvatar.avatarUrl).toBe('data:image/png;base64,WA==');

        await expect(
            authService.loginWithPassword(created.user.nick, 'old-password'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
            authService.loginWithPassword(created.user.nick, 'new-password'),
        ).resolves.toMatchObject({ user: { id: created.user.id } });
    });

    it('rotates and revokes a non-owner serial', async () => {
        const created = await authService.createUser('serial-user');
        await authService.firstAccess(created.user.nick, created.serial, 'serial-password');

        const rotated = await authService.rotateSerial(created.user.id);
        expect(rotated.serial).not.toBe(created.serial);
        expect(rotated.user.serialExpiresAt.getTime()).toBeGreaterThan(Date.now());
        await expect(
            authService.loginWithSerial(created.user.nick, created.serial),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(
            authService.loginWithSerial(created.user.nick, rotated.serial),
        ).resolves.toMatchObject({ user: { id: created.user.id } });

        const revoked = await authService.revokeSerial(created.user.id);
        expect(revoked.serialExpiresAt.getTime()).toBe(0);
        await expect(
            authService.loginWithSerial(created.user.nick, rotated.serial),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('keeps owners protected and removes sessions when a member is deactivated', async () => {
        const owner = await authService.createUser('owner-user');
        await seedWorkspace(testDatabase.db, owner.user.id, { name: 'Owner workspace' });
        const member = await authService.createUser('member-user');
        const memberSession = await authService.firstAccess(
            member.user.nick,
            member.serial,
            'member-password',
        );

        await expect(authService.setUserActive(owner.user.id, false)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(authService.rotateSerial(owner.user.id)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(authService.revokeSerial(owner.user.id)).rejects.toBeInstanceOf(
            ForbiddenException,
        );

        const deactivated = await authService.setUserActive(member.user.id, false);
        expect(deactivated.isActive).toBe(false);
        await expect(authService.getSession(memberSession.token)).resolves.toBeNull();
        await expect(
            authService.loginWithPassword(member.user.nick, 'member-password'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lists owners before regular users regardless of nick order', async () => {
        const regularZ = await authService.createUser('z-user');
        const owner = await authService.createUser('owner-user');
        const regularA = await authService.createUser('a-user');
        await seedWorkspace(testDatabase.db, owner.user.id, { name: 'Owner workspace' });

        const result = await authService.listUsers();

        expect(result.users.map((user) => user.nick)).toEqual(['owner-user', 'a-user', 'z-user']);
        expect(result.ownerIds).toContain(owner.user.id);
        expect(result.ownerIds).not.toContain(regularZ.user.id);
        expect(result.ownerIds).not.toContain(regularA.user.id);
    });

    it('deletes expired sessions when they are read', async () => {
        const user = await seedUser(testDatabase.db, { nick: 'expired-session-user' });
        const token = 'expired-session-token';
        const now = new Date();
        await testDatabase.db
            .insert(sessions)
            .values({
                id: 'expired-session-id',
                tokenHash: hashSessionToken(token),
                userId: user.id,
                expiresAt: new Date(0),
                createdAt: now,
                lastUsedAt: now,
            })
            .run();

        await expect(authService.getSession(token)).resolves.toBeNull();
        await expect(
            testDatabase.db
                .select()
                .from(sessions)
                .where(eq(sessions.id, 'expired-session-id'))
                .get(),
        ).resolves.toBeUndefined();
    });
});
