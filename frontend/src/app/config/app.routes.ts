import type { Route } from '@angular/router';
import { authGuard, ownerGuard } from '../core/auth.guards';
import { AdminUsersPageComponent } from '../pages/admin-page/admin-page.component';
import { DrivePageComponent } from '../pages/drive-page/drive-page.component';
import { LoginPageComponent } from '../pages/login-page/login-page.component';
import { SharePageComponent } from '../pages/share-page/share-page.component';

export const appRoutes: Route[] = [
    {
        path: 'login',
        component: LoginPageComponent,
    },
    {
        path: 'drive',
        component: DrivePageComponent,
        canActivate: [authGuard],
    },
    {
        path: 'admin/users',
        component: AdminUsersPageComponent,
        canActivate: [ownerGuard],
    },
    {
        path: 'share/:token',
        component: SharePageComponent,
    },
    { path: '', pathMatch: 'full', redirectTo: 'drive' },
    { path: '**', redirectTo: 'drive' },
];
