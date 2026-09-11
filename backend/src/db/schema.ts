import { randomUUID } from 'node:crypto';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { defaultStorageQuota } from '../storage/storage-quota';

const timestamps = {
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};

export const users = sqliteTable(
    'users',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        nick: text('nick').notNull(),
        displayName: text('display_name'),
        avatarUrl: text('avatar_url'),
        passwordHash: text('password_hash'),
        serialHash: text('serial_hash').notNull(),
        serialExpiresAt: integer('serial_expires_at', {
            mode: 'timestamp_ms',
        }).notNull(),
        serialLastUsedAt: integer('serial_last_used_at', { mode: 'timestamp_ms' }),
        serialRotatedAt: integer('serial_rotated_at', { mode: 'timestamp_ms' }),
        mustCreatePassword: integer('must_create_password', { mode: 'boolean' })
            .notNull()
            .default(true),
        isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
        ...timestamps,
    },
    (table) => ({ nickUnique: uniqueIndex('users_nick_unique').on(table.nick) }),
);

export const workspaces = sqliteTable('workspaces', {
    id: text('id')
        .primaryKey()
        .$defaultFn(() => randomUUID()),
    name: text('name').notNull(),
    quotaBytes: integer('quota_bytes').notNull().default(defaultStorageQuota),
    ...timestamps,
});

export const workspaceMembers = sqliteTable(
    'workspace_members',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        role: text('role', { enum: ['OWNER', 'MEMBER'] })
            .notNull()
            .default('MEMBER'),
        ...timestamps,
    },
    (table) => ({
        membershipUnique: uniqueIndex('workspace_members_unique').on(
            table.workspaceId,
            table.userId,
        ),
    }),
);

export const folders = sqliteTable(
    'folders',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
        parentId: text('parent_id'),
        name: text('name').notNull(),
        createdById: text('created_by_id')
            .notNull()
            .references(() => users.id),
        ...timestamps,
    },
    (table) => ({
        workspaceIndex: index('folders_workspace_idx').on(table.workspaceId),
    }),
);

export const files = sqliteTable(
    'files',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        workspaceId: text('workspace_id')
            .notNull()
            .references(() => workspaces.id, { onDelete: 'cascade' }),
        folderId: text('folder_id').references(() => folders.id, {
            onDelete: 'set null',
        }),
        originalName: text('original_name').notNull(),
        extension: text('extension').notNull().default(''),
        storedName: text('stored_name').notNull(),
        mimeType: text('mime_type').notNull(),
        size: integer('size').notNull(),
        storagePath: text('storage_path').notNull(),
        uploadedById: text('uploaded_by_id')
            .notNull()
            .references(() => users.id),
        ...timestamps,
    },
    (table) => ({
        workspaceIndex: index('files_workspace_idx').on(table.workspaceId),
    }),
);

export const fileShares = sqliteTable(
    'file_shares',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        fileId: text('file_id')
            .notNull()
            .references(() => files.id, { onDelete: 'cascade' }),
        token: text('token').notNull(),
        isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
        createdById: text('created_by_id')
            .notNull()
            .references(() => users.id),
        ...timestamps,
    },
    (table) => ({
        fileUnique: uniqueIndex('file_shares_file_unique').on(table.fileId),
        tokenUnique: uniqueIndex('file_shares_token_unique').on(table.token),
    }),
);

export const sessions = sqliteTable(
    'sessions',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        tokenHash: text('token_hash').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
        createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
        lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    },
    (table) => ({
        tokenUnique: uniqueIndex('sessions_token_unique').on(table.tokenHash),
        userIndex: index('sessions_user_idx').on(table.userId),
    }),
);

export const auditLogs = sqliteTable(
    'audit_logs',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => randomUUID()),
        userId: text('user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        event: text('event').notNull(),
        targetType: text('target_type').notNull(),
        targetId: text('target_id'),
        metadata: text('metadata'),
        createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    },
    (table) => ({
        userIndex: index('audit_logs_user_idx').on(table.userId),
        createdIndex: index('audit_logs_created_idx').on(table.createdAt),
    }),
);
