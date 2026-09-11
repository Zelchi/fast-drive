import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
    type CreateUserResponse,
    createUserInputSchema,
    createUserResponseSchema,
    type RotateSerialResponse,
    rotateSerialResponseSchema,
    type UserResponse,
    type UsersListResponse,
    updateUserInputSchema,
    userResponseSchema,
    usersListResponseSchema,
} from '@fast-drive/auth';
import type { Observable } from 'rxjs';
import { parseRequest, validateResponse } from './api-validation';

@Injectable({ providedIn: 'root' })
export class AdminApiService {
    constructor(private readonly http: HttpClient) {}

    listUsers(): Observable<UsersListResponse> {
        return this.http
            .get<unknown>('/api/users', { withCredentials: true })
            .pipe(validateResponse(usersListResponseSchema));
    }

    createUser(nick: string): Observable<CreateUserResponse> {
        return this.http
            .post<unknown>('/api/users', parseRequest(createUserInputSchema, { nick }), {
                withCredentials: true,
            })
            .pipe(validateResponse(createUserResponseSchema));
    }

    setUserActive(userId: string, isActive: boolean): Observable<UserResponse> {
        return this.http
            .patch<unknown>(
                `/api/users/${userId}`,
                parseRequest(updateUserInputSchema, { isActive }),
                {
                    withCredentials: true,
                },
            )
            .pipe(validateResponse(userResponseSchema));
    }

    rotateSerial(userId: string): Observable<RotateSerialResponse> {
        return this.http
            .post<unknown>(`/api/users/${userId}/rotate-serial`, {}, { withCredentials: true })
            .pipe(validateResponse(rotateSerialResponseSchema));
    }

    revokeSerial(userId: string): Observable<UserResponse> {
        return this.http
            .post<unknown>(`/api/users/${userId}/revoke-serial`, {}, { withCredentials: true })
            .pipe(validateResponse(userResponseSchema));
    }
}
