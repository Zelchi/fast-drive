import { mkdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { getStorageQuota } from '../storage/storage-quota';
import * as schema from './schema';

export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

const defaultDatabaseUrl = 'file:./data/fast-drive.sqlite';

function ensureDatabaseDirectory(databaseUrl: string): void {
    if (!databaseUrl.startsWith('file:')) {
        return;
    }

    const rawPath = databaseUrl.slice('file:'.length);
    if (!rawPath || rawPath.startsWith(':memory:')) {
        return;
    }

    const filePath = rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath);
    mkdirSync(dirname(filePath), { recursive: true });
}

async function ensureSchema(client: Client): Promise<void> {
    const storageQuota = getStorageQuota();
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      nick TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      password_hash TEXT,
      serial_hash TEXT NOT NULL,
      serial_expires_at INTEGER NOT NULL,
      serial_last_used_at INTEGER,
      serial_rotated_at INTEGER,
      must_create_password INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
    `);
    await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS users_nick_unique ON users (nick)');
    await addColumnIfMissing(client, 'ALTER TABLE users ADD COLUMN display_name TEXT');
    await addColumnIfMissing(client, 'ALTER TABLE users ADD COLUMN avatar_url TEXT');
    await addColumnIfMissing(client, 'ALTER TABLE users ADD COLUMN serial_last_used_at INTEGER');
    await addColumnIfMissing(client, 'ALTER TABLE users ADD COLUMN serial_rotated_at INTEGER');
    await client.execute(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      quota_bytes INTEGER NOT NULL DEFAULT ${storageQuota},
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
    await addColumnIfMissing(
        client,
        `ALTER TABLE workspaces ADD COLUMN quota_bytes INTEGER NOT NULL DEFAULT ${storageQuota}`,
    );
    await client.execute(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
    await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_unique ON workspace_members (workspace_id, user_id)',
    );
    await client.execute(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      parent_id TEXT,
      name TEXT NOT NULL,
      created_by_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
    await client.execute(
        'CREATE INDEX IF NOT EXISTS folders_workspace_idx ON folders (workspace_id)',
    );
    await client.execute(`
    CREATE TABLE IF NOT EXISTS files (
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
    await addColumnIfMissing(
        client,
        "ALTER TABLE files ADD COLUMN extension TEXT NOT NULL DEFAULT ''",
    );
    await backfillFileExtensions(client);
    await client.execute('CREATE INDEX IF NOT EXISTS files_workspace_idx ON files (workspace_id)');
    await client.execute(`
    CREATE TABLE IF NOT EXISTS file_shares (
      id TEXT PRIMARY KEY NOT NULL,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_by_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
    await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS file_shares_file_unique ON file_shares (file_id)',
    );
    await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS file_shares_token_unique ON file_shares (token)',
    );
    await client.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      token_hash TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    )
  `);
    await client.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_unique ON sessions (token_hash)',
    );
    await client.execute('CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)');
    await client.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      event TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);
    await client.execute('CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id)');
    await client.execute(
        'CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at)',
    );
}

async function hasTable(client: Client, tableName: string): Promise<boolean> {
    const result = await client.execute({
        sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        args: [tableName],
    });
    return result.rows.length > 0;
}

async function prepareLegacyDatabase(client: Client): Promise<void> {
    if (await hasTable(client, '__drizzle_migrations')) {
        return;
    }

    if (await hasTable(client, 'users')) {
        await ensureSchema(client);
    }
}

async function backfillFileExtensions(client: Client): Promise<void> {
    const result = await client.execute("SELECT id, original_name FROM files WHERE extension = ''");
    for (const row of result.rows) {
        const id = row.id;
        const originalName = row.original_name;
        if (typeof id !== 'string' || typeof originalName !== 'string') {
            continue;
        }
        const extension = extname(originalName);
        await client.execute({
            sql: 'UPDATE files SET extension = ? WHERE id = ?',
            args: [extension === '.' ? '' : extension, id],
        });
    }
}

async function addColumnIfMissing(client: Client, statement: string): Promise<void> {
    try {
        await client.execute(statement);
    } catch (error: unknown) {
        if (!String(error).toLowerCase().includes('duplicate column name')) {
            throw error;
        }
    }
}

export const createDatabase = async () => {
    const databaseUrl = process.env.DB_FILE_NAME ?? defaultDatabaseUrl;
    ensureDatabaseDirectory(databaseUrl);
    const client = createClient({ url: databaseUrl });
    await client.execute('PRAGMA foreign_keys = ON');
    await prepareLegacyDatabase(client);
    const database = drizzle({ client, schema });
    const migrationsFolder =
        process.env.DRIZZLE_MIGRATIONS_FOLDER?.trim() || resolve(process.cwd(), 'drizzle');
    await migrate(database, { migrationsFolder });
    return database;
};

export type Database = Awaited<ReturnType<typeof createDatabase>>;

@Global()
@Module({
    providers: [{ provide: DRIZZLE_DB, useFactory: createDatabase }],
    exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
