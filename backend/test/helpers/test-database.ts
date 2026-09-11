import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import type { Database } from '../../src/db/database.module';
import * as schema from '../../src/db/schema';
import { users, workspaceMembers, workspaces } from '../../src/db/schema';

export interface TestDatabase {
    db: Database;
    close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
    const databasePath = join(tmpdir(), `fast-drive-test-${randomUUID()}.sqlite`);
    const client = createClient({ url: `file:${databasePath}` });
    await createSchema(client);

    const db = drizzle({ client, schema }) as Database;
    return {
        db,
        close: async () => {
            client.close();
            await Promise.all([
                rm(databasePath, { force: true }),
                rm(`${databasePath}-wal`, { force: true }),
                rm(`${databasePath}-shm`, { force: true }),
            ]);
        },
    };
}

export async function seedUser(
    db: Database,
    overrides: Partial<typeof users.$inferInsert> = {},
): Promise<typeof users.$inferSelect> {
    const now = new Date();
    const user = {
        id: randomUUID(),
        nick: `user-${randomUUID().slice(0, 8)}`,
        displayName: null,
        avatarUrl: null,
        passwordHash: null,
        serialHash: 'unused-test-serial-hash',
        serialExpiresAt: new Date(now.getTime() + 86_400_000),
        serialLastUsedAt: null,
        serialRotatedAt: now,
        mustCreatePassword: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    } satisfies typeof users.$inferInsert;

    await db.insert(users).values(user).run();
    const record = await db.select().from(users).where(eq(users.id, user.id)).get();
    if (!record) {
        throw new Error('Não foi possível criar o usuário de teste.');
    }
    return record;
}

export async function seedWorkspace(
    db: Database,
    userId: string,
    options: {
        id?: string;
        name?: string;
        quotaBytes?: number;
        role?: 'OWNER' | 'MEMBER';
    } = {},
): Promise<{ workspaceId: string; memberId: string }> {
    const now = new Date();
    const workspaceId = options.id ?? randomUUID();
    const memberId = randomUUID();
    await db
        .insert(workspaces)
        .values({
            id: workspaceId,
            name: options.name ?? 'Workspace de teste',
            quotaBytes: options.quotaBytes ?? 1024 * 1024,
            createdAt: now,
            updatedAt: now,
        })
        .run();
    await db
        .insert(workspaceMembers)
        .values({
            id: memberId,
            workspaceId,
            userId,
            role: options.role ?? 'OWNER',
            createdAt: now,
            updatedAt: now,
        })
        .run();
    return { workspaceId, memberId };
}

async function createSchema(client: Client): Promise<void> {
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute(`
        CREATE TABLE users (
            id TEXT PRIMARY KEY NOT NULL,
            nick TEXT NOT NULL,
            display_name TEXT,
            avatar_url TEXT,
            password_hash TEXT,
            serial_hash TEXT NOT NULL,
            serial_expires_at INTEGER NOT NULL,
            serial_last_used_at INTEGER,
            serial_rotated_at INTEGER,
            must_create_password INTEGER NOT NULL DEFAULT true,
            is_active INTEGER NOT NULL DEFAULT true,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    await client.execute('CREATE UNIQUE INDEX users_nick_unique ON users (nick)');
    await client.execute(`
        CREATE TABLE workspaces (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            quota_bytes INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    await client.execute(`
        CREATE TABLE workspace_members (
            id TEXT PRIMARY KEY NOT NULL,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'MEMBER',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    await client.execute(
        'CREATE UNIQUE INDEX workspace_members_unique ON workspace_members (workspace_id, user_id)',
    );
    await client.execute(`
        CREATE TABLE folders (
            id TEXT PRIMARY KEY NOT NULL,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            parent_id TEXT,
            name TEXT NOT NULL,
            created_by_id TEXT NOT NULL REFERENCES users(id),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    await client.execute('CREATE INDEX folders_workspace_idx ON folders (workspace_id)');
    await client.execute(`
        CREATE TABLE files (
            id TEXT PRIMARY KEY NOT NULL,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
            original_name TEXT NOT NULL,
            extension TEXT NOT NULL DEFAULT '',
            stored_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            storage_path TEXT NOT NULL,
            uploaded_by_id TEXT NOT NULL REFERENCES users(id),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    await client.execute('CREATE INDEX files_workspace_idx ON files (workspace_id)');
    await client.execute(`
        CREATE TABLE file_shares (
            id TEXT PRIMARY KEY NOT NULL,
            file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            token TEXT NOT NULL,
            is_public INTEGER NOT NULL DEFAULT false,
            created_by_id TEXT NOT NULL REFERENCES users(id),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    await client.execute('CREATE UNIQUE INDEX file_shares_file_unique ON file_shares (file_id)');
    await client.execute('CREATE UNIQUE INDEX file_shares_token_unique ON file_shares (token)');
    await client.execute(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY NOT NULL,
            token_hash TEXT NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL
        )
    `);
    await client.execute('CREATE UNIQUE INDEX sessions_token_unique ON sessions (token_hash)');
    await client.execute('CREATE INDEX sessions_user_idx ON sessions (user_id)');
    await client.execute(`
        CREATE TABLE audit_logs (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            event TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL
        )
    `);
    await client.execute('CREATE INDEX audit_logs_user_idx ON audit_logs (user_id)');
    await client.execute('CREATE INDEX audit_logs_created_idx ON audit_logs (created_at)');
}
