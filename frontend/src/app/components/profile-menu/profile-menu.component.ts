import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ModalService } from '../../core/modal.service';
import { ServerConfigService } from '../../core/server-config.service';

const maxAvatarSourceSize = 8 * 1024 * 1024;
const maxAvatarDataUrlLength = 400_000;

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule],
    selector: 'app-profile-menu',
    templateUrl: './profile-menu.component.html',
    styleUrl: './profile-menu.component.css',
})
export class ProfileMenuComponent {
    readonly authService = inject(AuthService);

    private readonly elementRef = inject(ElementRef<HTMLElement>);
    private readonly modal = inject(ModalService);
    private readonly router = inject(Router);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    readonly serverConfig = inject(ServerConfigService);

    menuOpen = false;
    displayName = '';
    currentPassword = '';
    newPassword = '';
    passwordConfirmation = '';
    profileError = '';
    profileNotice = '';
    savingProfile = false;
    savingAvatar = false;

    get currentUser() {
        return this.authService.user();
    }

    get profileName(): string {
        return this.currentUser?.displayName || this.currentUser?.nick || 'Perfil';
    }

    get profileInitial(): string {
        return this.profileName.trim().charAt(0).toUpperCase() || '?';
    }

    toggleMenu(): void {
        this.menuOpen = !this.menuOpen;
        if (this.menuOpen) {
            this.resetForm();
        }
    }

    closeMenu(): void {
        if (!this.savingProfile && !this.savingAvatar) {
            this.menuOpen = false;
        }
    }

    @HostListener('document:pointerdown', ['$event'])
    closeOnOutsidePointer(event: PointerEvent): void {
        if (this.menuOpen && !this.elementRef.nativeElement.contains(event.target as Node)) {
            this.closeMenu();
        }
    }

    @HostListener('document:keydown.escape', ['$event'])
    closeOnEscape(event: Event): void {
        if (!this.menuOpen) {
            return;
        }
        event.preventDefault();
        this.closeMenu();
    }

    async saveProfile(): Promise<void> {
        const name = this.displayName.trim();
        if (!name) {
            this.profileError = 'Informe um nome para o perfil.';
            return;
        }

        if (this.currentPassword || this.newPassword || this.passwordConfirmation) {
            if (!this.currentPassword || !this.newPassword) {
                this.profileError = 'Informe a senha atual e a nova senha para alterar sua senha.';
                return;
            }
            if (this.newPassword !== this.passwordConfirmation) {
                this.profileError = 'A confirmação da nova senha não confere.';
                return;
            }
        }

        this.savingProfile = true;
        this.profileError = '';
        this.profileNotice = '';
        try {
            const response = await firstValueFrom(
                this.authService.updateProfile(
                    name,
                    this.currentPassword || undefined,
                    this.newPassword || undefined,
                ),
            );
            this.displayName = response.user.displayName;
            this.currentPassword = '';
            this.newPassword = '';
            this.passwordConfirmation = '';
            this.profileNotice = 'Perfil atualizado.';
        } catch (error: unknown) {
            this.profileError = this.readError(error);
        } finally {
            this.savingProfile = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async selectAvatar(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) {
            return;
        }

        this.savingAvatar = true;
        this.profileError = '';
        this.profileNotice = '';
        try {
            const avatarUrl = await this.prepareAvatar(file);
            await firstValueFrom(this.authService.updateAvatar(avatarUrl));
            this.profileNotice = 'Imagem atualizada.';
        } catch (error: unknown) {
            this.profileError = this.readError(error);
        } finally {
            this.savingAvatar = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async removeAvatar(): Promise<void> {
        if (!this.currentUser?.avatarUrl || this.savingAvatar) {
            return;
        }
        if (
            !(await this.modal.confirm(
                'Restaurar o avatar com a inicial do usuário?',
                'Remover imagem',
            ))
        ) {
            return;
        }

        this.savingAvatar = true;
        this.profileError = '';
        this.profileNotice = '';
        try {
            await firstValueFrom(this.authService.updateAvatar(null));
            this.profileNotice = 'Avatar padrão restaurado.';
        } catch (error: unknown) {
            this.profileError = this.readError(error);
        } finally {
            this.savingAvatar = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async logout(): Promise<void> {
        this.menuOpen = false;
        try {
            await firstValueFrom(this.authService.logout());
        } finally {
            await this.router.navigateByUrl('/login');
        }
    }

    async changeServer(): Promise<void> {
        if (
            !(await this.modal.confirm(
                'Você será desconectado deste servidor para configurar outro endereço.',
                'Trocar servidor',
            ))
        ) {
            return;
        }

        this.menuOpen = false;
        this.authService.clearCurrentUser();
        this.serverConfig.clear();
        await this.router.navigateByUrl('/login');
    }

    private resetForm(): void {
        this.displayName = this.profileName;
        this.currentPassword = '';
        this.newPassword = '';
        this.passwordConfirmation = '';
        this.profileError = '';
        this.profileNotice = '';
    }

    private async prepareAvatar(file: File): Promise<string> {
        if (!file.type.startsWith('image/')) {
            throw new Error('Selecione um arquivo de imagem.');
        }
        if (file.size > maxAvatarSourceSize) {
            throw new Error('A imagem deve ter no máximo 8 MB.');
        }

        const sourceUrl = await this.readFileAsDataUrl(file);
        const image = await this.loadImage(sourceUrl);
        const maxDimension = 256;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Não foi possível preparar a imagem.');
        }

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        for (const quality of [0.86, 0.72, 0.58, 0.44]) {
            const avatarUrl = canvas.toDataURL('image/jpeg', quality);
            if (avatarUrl.length <= maxAvatarDataUrlLength) {
                return avatarUrl;
            }
        }
        throw new Error('Não foi possível reduzir a imagem para o tamanho permitido.');
    }

    private readFileAsDataUrl(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result);
                    return;
                }
                reject(new Error('Não foi possível ler a imagem.'));
            };
            reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
            reader.readAsDataURL(file);
        });
    }

    private loadImage(sourceUrl: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('O arquivo de imagem é inválido.'));
            image.src = sourceUrl;
        });
    }

    private readError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        const response = error as { error?: { message?: string | string[] } };
        const message = response.error?.message;
        return Array.isArray(message)
            ? message.join(', ')
            : message || 'Não foi possível atualizar o perfil.';
    }
}
