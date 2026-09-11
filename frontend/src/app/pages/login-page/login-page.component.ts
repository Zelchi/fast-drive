import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';

@Component({
    standalone: true,
    imports: [FormsModule],
    selector: 'app-login-page',
    templateUrl: './login-page.component.html',
    styleUrl: './login-page.component.css',
})
export class LoginPageComponent {
    private readonly authService = inject(AuthService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly router = inject(Router);

    nick = '';
    credential = '';
    newPassword = '';
    firstAccessDetected = false;
    loading = false;
    error = '';

    async submit(): Promise<void> {
        this.loading = true;
        this.error = '';

        try {
            await firstValueFrom(
                this.authService.loginAutomatically(
                    this.nick,
                    this.credential,
                    this.firstAccessDetected ? this.newPassword : undefined,
                ),
            );
            await this.router.navigateByUrl('/drive');
        } catch (error: unknown) {
            if (this.isFirstAccessRequired(error)) {
                this.firstAccessDetected = true;
                this.error = '';
            } else {
                this.error = this.readError(error);
            }
        } finally {
            this.loading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    credentialChanged(): void {
        if (this.firstAccessDetected) {
            this.firstAccessDetected = false;
            this.newPassword = '';
        }
        this.error = '';
    }

    nickChanged(): void {
        if (this.firstAccessDetected) {
            this.firstAccessDetected = false;
            this.newPassword = '';
        }
        this.error = '';
    }

    private isFirstAccessRequired(error: unknown): boolean {
        const response = error as { error?: { code?: string } };
        return response.error?.code === 'FIRST_ACCESS_REQUIRED';
    }

    private readError(error: unknown): string {
        const response = error as { error?: { message?: string | string[] } };
        const message = response.error?.message;
        return Array.isArray(message)
            ? message.join(', ')
            : message || 'Não foi possível concluir o acesso.';
    }
}
