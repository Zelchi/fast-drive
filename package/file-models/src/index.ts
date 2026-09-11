import { z } from 'zod';

const isoDateSchema = z.iso.datetime();
const idSchema = z.string().trim().min(1).max(64);
const folderNameSchema = z.string().trim().min(1).max(255);
const fileNameSchema = z.string().trim().min(1).max(255);
const folderIdSchema = idSchema.nullable();

export const folderSchema = z
    .object({
        id: idSchema,
        name: z.string().min(1).max(255),
        parentId: folderIdSchema,
        createdAt: isoDateSchema,
        updatedAt: isoDateSchema,
    })
    .strict();

export type Folder = z.infer<typeof folderSchema>;

export const driveFileSchema = z
    .object({
        id: idSchema,
        originalName: z.string().min(1).max(255),
        extension: z.string().max(255),
        mimeType: z.string().min(1).max(255),
        size: z.number().int().nonnegative(),
        folderId: folderIdSchema,
        createdAt: isoDateSchema,
        updatedAt: isoDateSchema,
    })
    .strict();

export type DriveFile = z.infer<typeof driveFileSchema>;

export const fileShareSchema = z
    .object({
        fileId: idSchema,
        token: z.string().min(1),
        isPublic: z.boolean(),
        url: z.string().min(1),
        createdAt: isoDateSchema,
        updatedAt: isoDateSchema,
    })
    .strict();

export type FileShare = z.infer<typeof fileShareSchema>;

export const fileStorageOverviewSchema = z
    .object({
        quotaBytes: z.number().int().nonnegative(),
        usedBytes: z.number().int().nonnegative(),
        availableBytes: z.number().int().nonnegative(),
    })
    .strict();

export type FileStorageOverview = z.infer<typeof fileStorageOverviewSchema>;

export const fileListingSchema = z
    .object({
        workspaceId: idSchema,
        folderId: folderIdSchema,
        folders: z.array(folderSchema),
        files: z.array(driveFileSchema),
        storage: fileStorageOverviewSchema,
    })
    .strict();

export type FileListing = z.infer<typeof fileListingSchema>;

export const publicShareMetadataSchema = z
    .object({
        fileId: idSchema,
        token: z.string().min(1),
        originalName: z.string().min(1).max(255),
        extension: z.string().max(255),
        mimeType: z.string().min(1).max(255),
        size: z.number().int().nonnegative(),
        createdAt: isoDateSchema,
        updatedAt: isoDateSchema,
    })
    .strict();

export type PublicShareMetadata = z.infer<typeof publicShareMetadataSchema>;

export const createFolderInputSchema = z
    .object({
        name: folderNameSchema,
        parentId: folderIdSchema.optional(),
    })
    .strict();

export type CreateFolderInput = z.infer<typeof createFolderInputSchema>;

export const updateFolderInputSchema = z
    .object({
        name: folderNameSchema.optional(),
        parentId: folderIdSchema.optional(),
    })
    .strict();

export type UpdateFolderInput = z.infer<typeof updateFolderInputSchema>;

export const updateFileInputSchema = z
    .object({
        name: fileNameSchema.optional(),
        folderId: folderIdSchema.optional(),
        extension: z.string().trim().max(32).optional(),
    })
    .strict();

export type UpdateFileInput = z.infer<typeof updateFileInputSchema>;

export const updateFileShareInputSchema = z
    .object({
        isPublic: z.boolean(),
    })
    .strict();

export type UpdateFileShareInput = z.infer<typeof updateFileShareInputSchema>;

export const folderResponseSchema = z
    .object({
        folder: folderSchema,
    })
    .strict();

export type FolderResponse = z.infer<typeof folderResponseSchema>;

export const foldersResponseSchema = z
    .object({
        folders: z.array(folderSchema),
    })
    .strict();

export type FoldersResponse = z.infer<typeof foldersResponseSchema>;

export const fileResponseSchema = z
    .object({
        file: driveFileSchema,
    })
    .strict();

export type FileResponse = z.infer<typeof fileResponseSchema>;

export const fileShareResponseSchema = z
    .object({
        share: fileShareSchema,
    })
    .strict();

export type FileShareResponse = z.infer<typeof fileShareResponseSchema>;
