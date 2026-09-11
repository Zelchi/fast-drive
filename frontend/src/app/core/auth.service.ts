import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import {
    type AuthResponse,
    type AuthUser,
    authResponseSchema,
    automaticLoginInputSchema,
    firstAccessInputSchema,
    type LogoutResponse,
    logoutResponseSchema,
    passwordLoginInputSchema,
    serialLoginInputSchema,
    updateProfileAvatarInputSchema,
    updateProfileInputSchema,
} from '@fast-drive/auth';
import { type Observable, tap } from 'rxjs';
import { parseRequest, validateResponse } from './api-validation';

export type { AuthUser } from '@fast-drive/auth';
export type User = AuthUser;

@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly currentUser = signal<User | null>(null);
    readonly user = this.currentUser.asReadonly();

    constructor(private readonly http: HttpClient) {}

    me(): Observable<AuthResponse> {
        return this.http
            .get<unknown>('/api/auth/me', { withCredentials: true })
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    loginAutomatically(
        nick: string,
        credential: string,
        newPassword?: string,
    ): Observable<AuthResponse> {
        const body = parseRequest(
            automaticLoginInputSchema,
            newPassword ? { nick, credential, newPassword } : { nick, credential },
        );
        return this.http
            .post<unknown>('/api/auth/login', body, { withCredentials: true })
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    loginWithPassword(nick: string, password: string): Observable<AuthResponse> {
        return this.http
            .post<unknown>(
                '/api/auth/login/password',
                parseRequest(passwordLoginInputSchema, { nick, password }),
                { withCredentials: true },
            )
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    loginWithSerial(nick: string, serial: string): Observable<AuthResponse> {
        return this.http
            .post<unknown>(
                '/api/auth/login/serial',
                parseRequest(serialLoginInputSchema, { nick, serial }),
                { withCredentials: true },
            )
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    firstAccess(nick: string, serial: string, password: string): Observable<AuthResponse> {
        return this.http
            .post<unknown>(
                '/api/auth/first-access/password',
                parseRequest(firstAccessInputSchema, { nick, serial, password }),
                { withCredentials: true },
            )
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    updateProfile(
        displayName: string,
        currentPassword?: string,
        newPassword?: string,
    ): Observable<AuthResponse> {
        const body = parseRequest(updateProfileInputSchema, {
            displayName,
            ...(currentPassword ? { currentPassword } : {}),
            ...(newPassword ? { newPassword } : {}),
        });
        return this.http
            .patch<unknown>('/api/auth/profile', body, { withCredentials: true })
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    updateAvatar(avatarUrl: string | null): Observable<AuthResponse> {
        return this.http
            .patch<unknown>(
                '/api/auth/profile/avatar',
                parseRequest(updateProfileAvatarInputSchema, { avatarUrl }),
                { withCredentials: true },
            )
            .pipe(validateResponse(authResponseSchema))
            .pipe(tap(({ user }) => this.currentUser.set(user)));
    }

    logout(): Observable<LogoutResponse> {
        return this.http
            .post<unknown>('/api/auth/logout', {}, { withCredentials: true })
            .pipe(validateResponse(logoutResponseSchema))
            .pipe(tap(() => this.currentUser.set(null)));
    }
}
