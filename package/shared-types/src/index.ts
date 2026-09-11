import { z } from 'zod';

const isoDateSchema = z.iso.datetime();
const idSchema = z.string().trim().min(1).max(64);
const workspaceNameSchema = z.string().trim().min(1).max(120);
const quotaSchema = z.string().trim().min(1).max(32);

export const workspaceRoleSchema = z.enum(['OWNER', 'MEMBER']);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const workspaceSchema = z
    .object({
        id: idSchema,
        name: z.string().min(1).max(120),
        role: workspaceRoleSchema,
        quotaBytes: z.number().int().nonnegative(),
        usedBytes: z.number().int().nonnegative(),
        availableBytes: z.number().int().nonnegative(),
        createdAt: isoDateSchema,
        updatedAt: isoDateSchema,
    })
    .strict();

export type Workspace = z.infer<typeof workspaceSchema>;

export const storageOverviewSchema = z
    .object({
        totalBytes: z.number().int().nonnegative(),
        allocatedBytes: z.number().int().nonnegative(),
        availableBytes: z.number().int().nonnegative(),
    })
    .strict();

export type StorageOverview = z.infer<typeof storageOverviewSchema>;

export const workspaceMemberSchema = z
    .object({
        id: idSchema,
        userId: idSchema,
        nick: z.string().min(1).max(32),
        role: workspaceRoleSchema,
        createdAt: isoDateSchema,
    })
    .strict();

export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const createWorkspaceInputSchema = z
    .object({
        name: workspaceNameSchema,
        quota: quotaSchema,
    })
    .strict();

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = z
    .object({
        name: workspaceNameSchema.optional(),
        quota: quotaSchema.optional(),
    })
    .strict()
    .refine((value) => (value.name === undefined) !== (value.quota === undefined), {
        message: 'Informe exatamente um campo para atualizar o workspace.',
    });

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

export const addWorkspaceMemberInputSchema = z
    .object({
        userId: idSchema.optional(),
        nick: z.string().trim().min(3).max(32).optional(),
    })
    .strict()
    .refine((value) => value.userId !== undefined || value.nick !== undefined, {
        message: 'Informe o userId ou o nick do membro.',
    });

export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberInputSchema>;

export const workspacesResponseSchema = z
    .object({
        workspaces: z.array(workspaceSchema),
        storage: storageOverviewSchema,
    })
    .strict();

export type WorkspacesResponse = z.infer<typeof workspacesResponseSchema>;

export const workspaceMutationResponseSchema = z
    .object({
        workspace: workspaceSchema,
        storage: storageOverviewSchema,
    })
    .strict();

export type WorkspaceMutationResponse = z.infer<typeof workspaceMutationResponseSchema>;

export const membersResponseSchema = z
    .object({
        members: z.array(workspaceMemberSchema),
    })
    .strict();

export type MembersResponse = z.infer<typeof membersResponseSchema>;

export const memberResponseSchema = z
    .object({
        member: workspaceMemberSchema,
    })
    .strict();

export type MemberResponse = z.infer<typeof memberResponseSchema>;

export const successResponseSchema = z
    .object({
        success: z.literal(true),
    })
    .strict();

export type SuccessResponse = z.infer<typeof successResponseSchema>;
