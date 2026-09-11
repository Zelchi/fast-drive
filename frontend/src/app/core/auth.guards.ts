import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { DriveApiService } from './drive-api.service';

export const authGuard: CanActivateFn = (_route, _state) => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.user()) {
        return true;
    }

    return authService.me().pipe(
        map(() => true),
        catchError(() => of(router.createUrlTree(['/login']))),
    );
};

export const ownerGuard: CanActivateFn = (_route, _state) => {
    const authService = inject(AuthService);
    const driveApi = inject(DriveApiService);
    const router = inject(Router);
    const session$ = authService.user() ? of(true) : authService.me().pipe(map(() => true));

    return session$.pipe(
        switchMap(() => driveApi.listWorkspaces()),
        map(({ workspaces }) =>
            workspaces.some((workspace) => workspace.role === 'OWNER')
                ? true
                : router.createUrlTree(['/drive']),
        ),
        catchError((error: unknown) => {
            const status = (error as { status?: number }).status;
            return of(router.createUrlTree([status === 401 ? '/login' : '/drive']));
        }),
    );
};
