import { z } from 'zod';

const isoDateSchema = z.iso.datetime();
const nickSchema = z.string().trim().min(3).max(32);
const displayNameSchema = z.string().trim().min(1).max(64);
const passwordSchema = z.string().min(8).max(200);
const serialSchema = z.string().trim().min(1).max(200);
const avatarUrlSchema = z
    .string()
    .max(400_000)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

export const authUserSchema = z
    .object({
        id: z.string().min(1),
        nick: z.string().min(1).max(32),
        displayName: displayNameSchema,
        avatarUrl: avatarUrlSchema.nullable(),
        serialExpiresAt: isoDateSchema,
        mustCreatePassword: z.boolean(),
        isActive: z.boolean(),
        createdAt: isoDateSchema,
        updatedAt: isoDateSchema,
    })
    .strict();

export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z
    .object({
        user: authUserSchema,
    })
    .strict();

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const automaticLoginInputSchema = z
    .object({
        nick: nickSchema,
        credential: serialSchema,
        newPassword: passwordSchema.optional(),
    })
    .strict();

export type AutomaticLoginInput = z.infer<typeof automaticLoginInputSchema>;

export const firstAccessInputSchema = z
    .object({
        nick: nickSchema,
        serial: serialSchema,
        password: passwordSchema,
    })
    .strict();

export type FirstAccessInput = z.infer<typeof firstAccessInputSchema>;

export const passwordLoginInputSchema = z
    .object({
        nick: nickSchema,
        password: passwordSchema,
    })
    .strict();

export type PasswordLoginInput = z.infer<typeof passwordLoginInputSchema>;

export const serialLoginInputSchema = z
    .object({
        nick: nickSchema,
        serial: serialSchema,
    })
    .strict();

export type SerialLoginInput = z.infer<typeof serialLoginInputSchema>;

export const createUserInputSchema = z
    .object({
        nick: nickSchema.regex(/^[a-z0-9][a-z0-9._-]{2,31}$/i),
    })
    .strict();

export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = z
    .object({
        isActive: z.boolean().optional(),
    })
    .strict();

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const updateProfileInputSchema = z
    .object({
        displayName: displayNameSchema.optional(),
        currentPassword: passwordSchema.optional(),
        newPassword: passwordSchema.optional(),
    })
    .strict()
    .refine((value) => !value.newPassword || !!value.currentPassword, {
        message: 'Informe sua senha atual para definir uma nova senha.',
        path: ['currentPassword'],
    });

export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

export const updateProfileAvatarInputSchema = z
    .object({
        avatarUrl: avatarUrlSchema.nullable(),
    })
    .strict();

export type UpdateProfileAvatarInput = z.infer<typeof updateProfileAvatarInputSchema>;

export const logoutResponseSchema = z
    .object({
        success: z.literal(true),
    })
    .strict();

export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

export const usersListResponseSchema = z
    .object({
        users: z.array(authUserSchema),
        ownerIds: z.array(z.string().min(1)),
    })
    .strict();

export type UsersListResponse = z.infer<typeof usersListResponseSchema>;

export const createUserResponseSchema = z
    .object({
        user: authUserSchema,
        serial: z.string().min(1),
    })
    .strict();

export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

export const userResponseSchema = z
    .object({
        user: authUserSchema,
    })
    .strict();

export type UserResponse = z.infer<typeof userResponseSchema>;

export const rotateSerialResponseSchema = z
    .object({
        user: authUserSchema,
        serial: z.string().min(1),
    })
    .strict();

export type RotateSerialResponse = z.infer<typeof rotateSerialResponseSchema>;
