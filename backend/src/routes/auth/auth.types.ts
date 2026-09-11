import type { Request } from 'express';
import type { sessions, users } from '../../db/schema';

export type UserRecord = typeof users.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;

export type PublicUser = Pick<
    UserRecord,
    | 'id'
    | 'nick'
    | 'displayName'
    | 'avatarUrl'
    | 'serialExpiresAt'
    | 'mustCreatePassword'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
>;

export interface AuthenticatedRequest extends Request {
    user?: UserRecord;
    sessionId?: string;
}

export interface SessionContext {
    user: UserRecord;
    session: SessionRecord;
}
