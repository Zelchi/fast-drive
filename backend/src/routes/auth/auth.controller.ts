import {
    automaticLoginInputSchema,
    firstAccessInputSchema,
    passwordLoginInputSchema,
    serialLoginInputSchema,
    updateProfileAvatarInputSchema,
    updateProfileInputSchema,
} from '@fast-drive/auth';
import { Body, Controller, Get, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseWithZod } from '../../common/zod-validation';
import { SessionGuard, sessionCookieName } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

type CookieSameSite = 'lax' | 'strict' | 'none';

const cookieSecure = process.env.COOKIE_SECURE === 'true';
const configuredSameSite = process.env.COOKIE_SAME_SITE?.trim().toLowerCase();
const sameSite: CookieSameSite =
    configuredSameSite === 'lax' || configuredSameSite === 'strict'
        ? configuredSameSite
        : configuredSameSite === 'none' && cookieSecure
          ? 'none'
          : cookieSecure
            ? 'none'
            : 'lax';

const sessionCookieOptions = {
    httpOnly: true,
    sameSite,
    secure: cookieSecure,
    path: '/',
};

function setSessionCookie(response: Response, token: string): void {
    const sessionTtlSeconds =
        Number(process.env.SESSION_TTL_SECONDS) > 0
            ? Number(process.env.SESSION_TTL_SECONDS)
            : 2_592_000;
    response.cookie(sessionCookieName, token, {
        ...sessionCookieOptions,
        maxAge: sessionTtlSeconds * 1000,
    });
}

function publicUser(authService: AuthService, user: AuthenticatedRequest['user']) {
    return user ? authService.toPublicUser(user) : null;
}

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('login')
    @UseGuards(LoginRateLimitGuard)
    async loginAutomatically(
        @Body() body: unknown,
        @Res({ passthrough: true }) response: Response,
    ) {
        const input = parseWithZod(automaticLoginInputSchema, body);
        const result = await this.authService.loginAutomatically(
            input.nick,
            input.credential,
            input.newPassword,
        );
        setSessionCookie(response, result.token);
        return { user: this.authService.toPublicUser(result.user) };
    }

    @Post('first-access/password')
    @UseGuards(LoginRateLimitGuard)
    async firstAccess(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
        const input = parseWithZod(firstAccessInputSchema, body);
        const result = await this.authService.firstAccess(input.nick, input.serial, input.password);
        setSessionCookie(response, result.token);
        return { user: this.authService.toPublicUser(result.user) };
    }

    @Post('login/password')
    @UseGuards(LoginRateLimitGuard)
    async loginWithPassword(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
        const input = parseWithZod(passwordLoginInputSchema, body);
        const result = await this.authService.loginWithPassword(input.nick, input.password);
        setSessionCookie(response, result.token);
        return { user: this.authService.toPublicUser(result.user) };
    }

    @Post('login/serial')
    @UseGuards(LoginRateLimitGuard)
    async loginWithSerial(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
        const input = parseWithZod(serialLoginInputSchema, body);
        const result = await this.authService.loginWithSerial(input.nick, input.serial);
        setSessionCookie(response, result.token);
        return { user: this.authService.toPublicUser(result.user) };
    }

    @UseGuards(SessionGuard)
    @Get('me')
    getCurrentUser(@Req() request: AuthenticatedRequest) {
        return { user: publicUser(this.authService, request.user) };
    }

    @UseGuards(SessionGuard)
    @Patch('profile')
    updateProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
        const input = parseWithZod(updateProfileInputSchema, body);
        return this.authService
            .updateProfile(request.user?.id ?? '', input)
            .then((user) => ({ user }));
    }

    @UseGuards(SessionGuard)
    @Patch('profile/avatar')
    updateAvatar(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
        const { avatarUrl } = parseWithZod(updateProfileAvatarInputSchema, body);
        return this.authService
            .updateAvatar(request.user?.id ?? '', avatarUrl)
            .then((user) => ({ user }));
    }

    @UseGuards(SessionGuard)
    @Post('logout')
    async logout(
        @Req() request: AuthenticatedRequest,
        @Res({ passthrough: true }) response: Response,
    ) {
        const token = this.readSessionToken(request);
        if (token) {
            await this.authService.destroySession(token);
        }
        response.clearCookie(sessionCookieName, sessionCookieOptions);
        return { success: true };
    }

    private readSessionToken(request: Request): string | undefined {
        const header = request.headers.cookie;
        if (!header) {
            return undefined;
        }
        const cookie = header
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${sessionCookieName}=`));
        return cookie?.slice(sessionCookieName.length + 1);
    }
}
