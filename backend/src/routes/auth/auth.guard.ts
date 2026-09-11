import {
    type CanActivate,
    type ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

export const sessionCookieName = process.env.SESSION_COOKIE_NAME?.trim() || 'fast_drive_session';

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
    if (!cookieHeader) {
        return undefined;
    }

    for (const part of cookieHeader.split(';')) {
        const separator = part.indexOf('=');
        if (separator === -1 || part.slice(0, separator).trim() !== name) {
            continue;
        }
        const value = part.slice(separator + 1).trim();
        try {
            return decodeURIComponent(value);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

@Injectable()
export class SessionGuard implements CanActivate {
    constructor(private readonly authService: AuthService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const token = readCookie(request.headers.cookie, sessionCookieName);
        if (!token) {
            throw new UnauthorizedException('Sessão não encontrada.');
        }

        const session = await this.authService.getSession(token);
        if (!session) {
            throw new UnauthorizedException('Sessão inválida ou expirada.');
        }

        request.user = session.user;
        request.sessionId = session.session.id;
        return true;
    }
}
