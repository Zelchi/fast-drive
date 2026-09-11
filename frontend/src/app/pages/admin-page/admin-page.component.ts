import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ProfileMenuComponent } from '../../components/profile-menu/profile-menu.component';
import { AdminApiService } from '../../core/admin-api.service';
import { AuthService, type User } from '../../core/auth.service';
import { ModalService } from '../../core/modal.service';

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, ProfileMenuComponent],
    selector: 'app-admin-page',
    templateUrl: './admin-page.component.html',
    styleUrl: './admin-page.component.css',
})
export class AdminUsersPageComponent {
    readonly authService = inject(AuthService);
    private readonly adminApi = inject(AdminApiService);
    private readonly modal = inject(ModalService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);

    users: User[] = [];
    newNick = '';
    loading = true;
    saving = false;
    error = '';
    notice = '';
    revealedSerial = '';
    private ownerIds = new Set<string>();

    async ngOnInit(): Promise<void> {
        await this.reload();
    }

    async createUser(): Promise<void> {
        const nick = this.newNick.trim();
        if (!nick) {
            this.error = 'Informe um nick para criar o usuário.';
            return;
        }

        this.startAction();
        try {
            const result = await firstValueFrom(this.adminApi.createUser(nick));
            this.users = this.sortUsers([result.user, ...this.users]);
            this.newNick = '';
            this.revealedSerial = result.serial;
            this.notice = `Usuário ${result.user.nick} criado.`;
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.saving = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async toggleUser(user: User): Promise<void> {
        const isActive = !user.isActive;
        if (!isActive && this.isOwnerUser(user)) {
            this.error = 'O owner não pode ser desativado.';
            return;
        }
        if (
            !(await this.modal.confirm(
                `${isActive ? 'Ativar' : 'Desativar'} o usuário ${user.nick}?`,
                `${isActive ? 'Ativar' : 'Desativar'} usuário`,
            ))
        ) {
            return;
        }

        this.startAction();
        try {
            const result = await firstValueFrom(this.adminApi.setUserActive(user.id, isActive));
            this.replaceUser(result.user);
            this.notice = `Usuário ${result.user.nick} ${isActive ? 'ativado' : 'desativado'}.`;
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.saving = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async rotateSerial(user: User): Promise<void> {
        if (this.isOwnerUser(user)) {
            this.error = 'O owner não pode receber um novo serial.';
            return;
        }
        if (
            !(await this.modal.confirm(
                `Gerar um novo serial para ${user.nick}? O serial atual deixará de funcionar.`,
                'Novo serial',
            ))
        ) {
            return;
        }

        this.startAction();
        try {
            const result = await firstValueFrom(this.adminApi.rotateSerial(user.id));
            this.replaceUser(result.user);
            this.revealedSerial = result.serial;
            this.notice = `Serial de ${result.user.nick} renovado.`;
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.saving = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async revokeSerial(user: User): Promise<void> {
        if (this.isOwnerUser(user)) {
            this.error = 'O serial do owner não pode ser revogado.';
            return;
        }
        if (
            !(await this.modal.confirm(
                `Revogar o serial de ${user.nick}? Essa ação não pode ser desfeita.`,
                'Revogar serial',
            ))
        ) {
            return;
        }

        this.startAction();
        try {
            const result = await firstValueFrom(this.adminApi.revokeSerial(user.id));
            this.replaceUser(result.user);
            this.revealedSerial = '';
            this.notice = `Serial de ${result.user.nick} revogado.`;
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.saving = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async copySerial(): Promise<void> {
        if (!this.revealedSerial || !navigator.clipboard) {
            return;
        }
        await navigator.clipboard.writeText(this.revealedSerial);
        this.notice = 'Serial copiado para a área de transferência.';
        this.changeDetectorRef.markForCheck();
    }

    formatDate(value: string): string {
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(value));
    }

    serialStatus(user: User): string {
        if (!user.isActive) {
            return 'Usuário desativado';
        }
        if (user.mustCreatePassword) {
            return 'Primeiro acesso';
        }
        if (new Date(user.serialExpiresAt).getTime() <= Date.now()) {
            return 'Serial expirado';
        }
        return 'Serial ativo';
    }

    private async reload(): Promise<void> {
        this.loading = true;
        this.error = '';
        try {
            const response = await firstValueFrom(this.adminApi.listUsers());
            this.ownerIds = new Set(response.ownerIds);
            this.users = this.sortUsers(response.users);
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.loading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    private startAction(): void {
        this.saving = true;
        this.error = '';
        this.notice = '';
    }

    private replaceUser(updatedUser: User): void {
        this.users = this.sortUsers(
            this.users.map((user) => (user.id === updatedUser.id ? updatedUser : user)),
        );
    }

    isOwnerUser(user: User): boolean {
        return this.ownerIds.has(user.id) || user.id === this.authService.user()?.id;
    }

    private sortUsers(users: User[]): User[] {
        return [...users].sort((left, right) => {
            const ownerOrder = Number(this.isOwnerUser(right)) - Number(this.isOwnerUser(left));
            return ownerOrder || left.nick.localeCompare(right.nick);
        });
    }

    private readError(error: unknown): string {
        const response = error as { error?: { message?: string | string[] } };
        const message = response.error?.message;
        return Array.isArray(message)
            ? message.join(', ')
            : message || 'Não foi possível concluir a operação.';
    }
}
