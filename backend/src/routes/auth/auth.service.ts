import { randomUUID } from 'node:crypto';
import type { UpdateProfileInput } from '@fast-drive/auth';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { type Database, DRIZZLE_DB } from '../../db/database.module';
import { sessions, users, workspaceMembers, workspaces } from '../../db/schema';
import { getStorageQuota } from '../../storage/storage-quota';
import {
    generateOpaqueToken,
    generateSerial,
    hashSecret,
    hashSessionToken,
    verifySecret,
} from './auth.crypto';
import type { PublicUser, SessionContext, UserRecord } from './auth.types';

export interface AuthenticationResult {
    user: UserRecord;
    token: string;
}

export interface CreatedUserResult {
    user: UserRecord;
    serial: string;
}

const invalidCredentialsMessage = 'Nick ou credencial inválida.';

@Injectable()
export class AuthService {
    private readonly sessionTtlMs =
        this.readPositiveNumber('SESSION_TTL_SECONDS', 2_592_000) * 1000;
    private readonly serialTtlMs =
        this.readPositiveNumber('SERIAL_TTL_DAYS', 3) * 24 * 60 * 60 * 1000;

    constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

    toPublicUser(user: UserRecord): PublicUser {
        return {
            id: user.id,
            nick: user.nick,
            displayName: user.displayName?.trim() || user.nick,
            avatarUrl: user.avatarUrl ?? null,
            serialExpiresAt: user.serialExpiresAt,
            mustCreatePassword: user.mustCreatePassword,
            isActive: user.isActive,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }

    async firstAccess(
        nickInput: string,
        serial: string,
        password: string,
    ): Promise<AuthenticationResult> {
        const nick = this.normalizeNick(nickInput);
        this.validatePassword(password);
        if (!serial.trim()) {
            throw new BadRequestException('O serial é obrigatório.');
        }

        const user = await this.findByNick(nick);
        const serialIsValid = user ? await verifySecret(serial.trim(), user.serialHash) : false;
        if (
            !user?.isActive ||
            !user.mustCreatePassword ||
            user.serialExpiresAt.getTime() <= Date.now() ||
            !serialIsValid
        ) {
            throw new UnauthorizedException(invalidCredentialsMessage);
        }

        const now = new Date();
        await this.db
            .update(users)
            .set({
                passwordHash: await hashSecret(password),
                mustCreatePassword: false,
                updatedAt: now,
            })
            .where(eq(users.id, user.id))
            .run();

        return this.authenticateUser(user.id);
    }

    async loginAutomatically(
        nickInput: string,
        credentialInput: string,
        newPassword?: string,
    ): Promise<AuthenticationResult> {
        const nick = this.normalizeNick(nickInput);
        const credential = credentialInput.trim();
        if (!credential) {
            throw new BadRequestException('Informe sua senha ou serial.');
        }

        const user = await this.findByNick(nick);
        if (!user?.isActive) {
            throw new UnauthorizedException(invalidCredentialsMessage);
        }

        if (user.mustCreatePassword) {
            const serialIsValid = await verifySecret(credential, user.serialHash);
            if (!serialIsValid || user.serialExpiresAt.getTime() <= Date.now()) {
                throw new UnauthorizedException(invalidCredentialsMessage);
            }
            if (!newPassword) {
                throw new ForbiddenException({
                    code: 'FIRST_ACCESS_REQUIRED',
                    message: 'Primeiro acesso detectado. Crie uma senha para continuar.',
                });
            }

            this.validatePassword(newPassword);
            const now = new Date();
            await this.db
                .update(users)
                .set({
                    passwordHash: await hashSecret(newPassword),
                    mustCreatePassword: false,
                    updatedAt: now,
                })
                .where(eq(users.id, user.id))
                .run();
            return this.authenticateUser(user.id);
        }

        if (user.passwordHash && (await verifySecret(credential, user.passwordHash))) {
            return this.authenticateUser(user.id);
        }

        const serialIsValid = await verifySecret(credential, user.serialHash);
        if (!serialIsValid) {
            throw new UnauthorizedException(invalidCredentialsMessage);
        }
        if (user.serialExpiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedException('O serial expirou.');
        }

        const now = new Date();
        await this.db
            .update(users)
            .set({ serialLastUsedAt: now, updatedAt: now })
            .where(eq(users.id, user.id))
            .run();
        return this.authenticateUser(user.id);
    }

    async loginWithPassword(nickInput: string, password: string): Promise<AuthenticationResult> {
        const nick = this.normalizeNick(nickInput);
        this.validatePassword(password);
        const user = await this.findByNick(nick);
        if (!user?.isActive || !user.passwordHash) {
            throw new UnauthorizedException(invalidCredentialsMessage);
        }
        if (user.mustCreatePassword) {
            throw new ForbiddenException('Conclua o primeiro acesso antes de entrar com a senha.');
        }
        if (!(await verifySecret(password, user.passwordHash))) {
            throw new UnauthorizedException(invalidCredentialsMessage);
        }

        return this.authenticateUser(user.id);
    }

    async loginWithSerial(nickInput: string, serial: string): Promise<AuthenticationResult> {
        const nick = this.normalizeNick(nickInput);
        if (!serial.trim()) {
            throw new BadRequestException('O serial é obrigatório.');
        }

        const user = await this.findByNick(nick);
        const serialIsValid = user ? await verifySecret(serial.trim(), user.serialHash) : false;
        if (!user?.isActive || user.mustCreatePassword || !serialIsValid) {
            throw new UnauthorizedException(invalidCredentialsMessage);
        }
        if (user.serialExpiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedException('O serial expirou.');
        }

        const now = new Date();
        await this.db
            .update(users)
            .set({ serialLastUsedAt: now, updatedAt: now })
            .where(eq(users.id, user.id))
            .run();

        return this.authenticateUser(user.id);
    }

    async getSession(token: string): Promise<SessionContext | null> {
        const tokenHash = hashSessionToken(token);
        const session = await this.db
            .select()
            .from(sessions)
            .where(eq(sessions.tokenHash, tokenHash))
            .get();

        if (!session) {
            return null;
        }

        const user = await this.findById(session.userId);
        if (!user?.isActive || session.expiresAt.getTime() <= Date.now()) {
            await this.db.delete(sessions).where(eq(sessions.id, session.id)).run();
            return null;
        }

        const lastUsedAt = new Date();
        await this.db.update(sessions).set({ lastUsedAt }).where(eq(sessions.id, session.id)).run();

        return { user, session: { ...session, lastUsedAt } };
    }

    async destroySession(token: string): Promise<void> {
        await this.db
            .delete(sessions)
            .where(eq(sessions.tokenHash, hashSessionToken(token)))
            .run();
    }

    async updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
        const user = await this.requireUser(userId);
        const updates: {
            displayName?: string;
            passwordHash?: string;
            mustCreatePassword?: boolean;
            updatedAt: Date;
        } = { updatedAt: new Date() };

        if (input.displayName !== undefined) {
            updates.displayName = input.displayName.trim();
        }

        if (input.newPassword !== undefined) {
            if (
                !user.passwordHash ||
                !input.currentPassword ||
                !(await verifySecret(input.currentPassword, user.passwordHash))
            ) {
                throw new UnauthorizedException('A senha atual está incorreta.');
            }
            this.validatePassword(input.newPassword);
            updates.passwordHash = await hashSecret(input.newPassword);
            updates.mustCreatePassword = false;
        }

        await this.db.update(users).set(updates).where(eq(users.id, user.id)).run();
        return this.toPublicUser(await this.requireUser(user.id));
    }

    async updateAvatar(userId: string, avatarUrl: string | null): Promise<PublicUser> {
        const user = await this.requireUser(userId);
        await this.db
            .update(users)
            .set({ avatarUrl, updatedAt: new Date() })
            .where(eq(users.id, user.id))
            .run();
        return this.toPublicUser(await this.requireUser(user.id));
    }

    async listUsers(): Promise<{ users: PublicUser[]; ownerIds: string[] }> {
        const [records, ownerRecords] = await Promise.all([
            this.db.select().from(users).orderBy(users.nick).all(),
            this.db
                .select({ userId: workspaceMembers.userId })
                .from(workspaceMembers)
                .where(eq(workspaceMembers.role, 'OWNER'))
                .all(),
        ]);
        const ownerIds = new Set(ownerRecords.map((record) => record.userId));
        return {
            users: records
                .sort((left, right) => {
                    const ownerOrder =
                        Number(ownerIds.has(right.id)) - Number(ownerIds.has(left.id));
                    return ownerOrder || left.nick.localeCompare(right.nick);
                })
                .map((user) => this.toPublicUser(user)),
            ownerIds: [...ownerIds],
        };
    }

    async createUser(nickInput: string): Promise<CreatedUserResult> {
        const nick = this.normalizeNick(nickInput);
        this.validateNick(nick);
        if (await this.findByNick(nick)) {
            throw new ConflictException('Já existe um usuário com esse nick.');
        }

        const serial = generateSerial();
        const now = new Date();
        const userId = randomUUID();
        const userValues = {
            id: userId,
            nick,
            displayName: nick,
            avatarUrl: null,
            passwordHash: null,
            serialHash: await hashSecret(serial),
            serialExpiresAt: new Date(now.getTime() + this.serialTtlMs),
            serialRotatedAt: now,
            mustCreatePassword: true,
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };

        await this.db.insert(users).values(userValues).run();
        const user = await this.findById(userId);
        if (!user) {
            throw new Error('Não foi possível criar o usuário.');
        }
        return { user, serial };
    }

    async rotateSerial(userId: string): Promise<{ user: PublicUser; serial: string }> {
        const user = await this.requireNonOwner(userId, 'receber um novo serial');
        const serial = generateSerial();
        const now = new Date();
        await this.db
            .update(users)
            .set({
                serialHash: await hashSecret(serial),
                serialExpiresAt: new Date(now.getTime() + this.serialTtlMs),
                serialLastUsedAt: null,
                serialRotatedAt: now,
                updatedAt: now,
            })
            .where(eq(users.id, user.id))
            .run();

        const updatedUser = await this.requireUser(user.id);
        return { user: this.toPublicUser(updatedUser), serial };
    }

    async revokeSerial(userId: string): Promise<PublicUser> {
        const user = await this.requireNonOwner(userId, 'ter o serial revogado');
        const now = new Date();
        await this.db
            .update(users)
            .set({
                serialHash: await hashSecret(generateOpaqueToken()),
                serialExpiresAt: new Date(0),
                serialLastUsedAt: null,
                serialRotatedAt: now,
                updatedAt: now,
            })
            .where(eq(users.id, user.id))
            .run();
        return this.toPublicUser(await this.requireUser(user.id));
    }

    async setUserActive(userId: string, isActive: boolean): Promise<PublicUser> {
        const user = await this.requireUser(userId);
        if (!isActive && (await this.isOwner(user.id))) {
            throw new ForbiddenException('O owner não pode ser desativado.');
        }
        const now = new Date();
        await this.db
            .update(users)
            .set({ isActive, updatedAt: now })
            .where(eq(users.id, user.id))
            .run();
        if (!isActive) {
            await this.db.delete(sessions).where(eq(sessions.userId, user.id)).run();
        }
        return this.toPublicUser(await this.requireUser(user.id));
    }

    async isOwner(userId: string, workspaceId?: string): Promise<boolean> {
        const conditions = [
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.role, 'OWNER'),
        ];
        if (workspaceId) {
            conditions.push(eq(workspaceMembers.workspaceId, workspaceId));
        }
        return Boolean(
            await this.db
                .select({ id: workspaceMembers.id })
                .from(workspaceMembers)
                .where(and(...conditions))
                .get(),
        );
    }

    async ensureInitialOwner(): Promise<void> {
        const nickInput = process.env.OWNER_NICK?.trim();
        const serial = process.env.OWNER_SERIAL?.trim();
        if (!nickInput || !serial) {
            return;
        }

        const nick = this.normalizeNick(nickInput);
        const now = new Date();
        const userId = randomUUID();
        const workspaceId = randomUUID();
        const workspaceName = process.env.OWNER_WORKSPACE?.trim() || 'Meu workspace';
        const serialHash = await hashSecret(serial);
        await this.db.transaction(async (tx) => {
            const existing = await tx
                .select({ id: users.id })
                .from(users)
                .where(eq(users.nick, nick))
                .get();
            if (existing) {
                return;
            }

            await tx
                .insert(users)
                .values({
                    id: userId,
                    nick,
                    displayName: nick,
                    avatarUrl: null,
                    passwordHash: null,
                    serialHash,
                    serialExpiresAt: new Date(now.getTime() + this.serialTtlMs),
                    serialRotatedAt: now,
                    mustCreatePassword: true,
                    isActive: true,
                    createdAt: now,
                    updatedAt: now,
                })
                .run();
            await tx
                .insert(workspaces)
                .values({
                    id: workspaceId,
                    name: workspaceName,
                    quotaBytes: getStorageQuota(),
                    createdAt: now,
                    updatedAt: now,
                })
                .run();
            await tx
                .insert(workspaceMembers)
                .values({
                    id: randomUUID(),
                    workspaceId,
                    userId,
                    role: 'OWNER',
                    createdAt: now,
                    updatedAt: now,
                })
                .run();
        });
    }

    async requireUser(userId: string): Promise<UserRecord> {
        const user = await this.findById(userId);
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }
        return user;
    }

    private async requireNonOwner(userId: string, action: string): Promise<UserRecord> {
        const user = await this.requireUser(userId);
        if (await this.isOwner(user.id)) {
            throw new ForbiddenException(`O owner não pode ${action}.`);
        }
        return user;
    }

    private async authenticateUser(userId: string): Promise<AuthenticationResult> {
        const user = await this.requireUser(userId);
        const token = generateOpaqueToken();
        const now = new Date();
        await this.db
            .delete(sessions)
            .where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, now)))
            .run();
        await this.db
            .insert(sessions)
            .values({
                id: randomUUID(),
                tokenHash: hashSessionToken(token),
                userId: user.id,
                expiresAt: new Date(now.getTime() + this.sessionTtlMs),
                createdAt: now,
                lastUsedAt: now,
            })
            .run();
        return { user, token };
    }

    private async findByNick(nick: string): Promise<UserRecord | undefined> {
        return this.db.select().from(users).where(eq(users.nick, nick)).get();
    }

    private async findById(id: string): Promise<UserRecord | undefined> {
        return this.db.select().from(users).where(eq(users.id, id)).get();
    }

    private normalizeNick(nick: string): string {
        return nick.trim().toLowerCase();
    }

    private validateNick(nick: string): void {
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(nick)) {
            throw new BadRequestException(
                'O nick deve ter entre 3 e 32 caracteres e usar letras, números, ponto, hífen ou sublinhado.',
            );
        }
    }

    private validatePassword(password: string): void {
        if (password.length < 8 || password.length > 200) {
            throw new BadRequestException('A senha deve ter entre 8 e 200 caracteres.');
        }
    }

    private readPositiveNumber(name: string, fallback: number): number {
        const value = Number(process.env[name]);
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }
}
