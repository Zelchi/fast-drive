import { CommonModule } from '@angular/common';
import { HttpEventType } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, lastValueFrom, type Observable, tap, timeout } from 'rxjs';
import { ProfileMenuComponent } from '../../components/profile-menu/profile-menu.component';
import { AuthService } from '../../core/auth.service';
import {
    DriveApiService,
    type DriveFile,
    type FileListing,
    type FileShare,
    type Folder,
    type StorageOverview,
    type Workspace,
    type WorkspaceMember,
} from '../../core/drive-api.service';
import { ModalService } from '../../core/modal.service';

interface FolderOption {
    folder: Folder;
    label: string;
}

@Component({
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, ProfileMenuComponent],
    selector: 'app-drive-page',
    templateUrl: './drive-page.component.html',
    styleUrl: './drive-page.component.css',
})
export class DrivePageComponent {
    readonly authService = inject(AuthService);
    readonly driveApi = inject(DriveApiService);
    private readonly modal = inject(ModalService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly router = inject(Router);

    @ViewChild('membersModalViewport') private membersModalViewport?: ElementRef<HTMLElement>;

    workspaces: Workspace[] = [];
    selectedWorkspace: Workspace | null = null;
    listing: FileListing | null = null;
    currentFolder: Folder | null = null;
    folderPath: Folder[] = [];
    folderName = '';
    workspaceName = '';
    workspaceQuotaPercent = 50;
    workspaceFormOpen = false;
    creatingWorkspace = false;
    membersOpen = false;
    members: WorkspaceMember[] = [];
    memberNick = '';
    loadingMembers = false;
    savingMember = false;
    membersScrollbarVisible = false;
    membersScrollbarThumbHeight = 0;
    membersScrollbarThumbOffset = 0;
    contextMenuOpen = false;
    contextMenuType: 'file' | 'folder' | 'workspace' | null = null;
    contextMenuFile: DriveFile | null = null;
    contextMenuFolder: Folder | null = null;
    contextMenuWorkspace: Workspace | null = null;
    contextMenuX = 0;
    contextMenuY = 0;
    draggedFile: DriveFile | null = null;
    dragOverDropTarget: string | null = null;
    movingDraggedFile = false;
    shareOpen = false;
    sharingFile: DriveFile | null = null;
    fileShare: FileShare | null = null;
    loadingShare = false;
    savingShare = false;
    shareUrlCopied = false;
    shareError = '';
    moveOpen = false;
    movingFile: DriveFile | null = null;
    moveFolders: Folder[] = [];
    moveTargetFolderId = '';
    loadingMove = false;
    savingMove = false;
    moveError = '';
    storageOverview: StorageOverview = { totalBytes: 0, allocatedBytes: 0, availableBytes: 0 };
    loading = true;
    loadingStep = 'Carregando seu drive...';
    uploading = false;
    uploadProgress = 0;
    uploadFileName = '';
    error = '';

    get isOwner(): boolean {
        return this.workspaces.some((workspace) => workspace.role === 'OWNER');
    }

    async ngOnInit(): Promise<void> {
        await this.loadDrive();
    }

    async retryLoad(): Promise<void> {
        this.selectedWorkspace = null;
        this.listing = null;
        this.folderPath = [];
        this.workspaces = [];
        this.members = [];
        this.membersOpen = false;
        this.memberNick = '';
        this.resetMembersScrollbar();
        this.closeContextMenu();
        this.closeShareModal();
        this.closeMoveModal();
        this.storageOverview = { totalBytes: 0, allocatedBytes: 0, availableBytes: 0 };
        await this.loadDrive();
    }

    private async loadDrive(): Promise<void> {
        this.loading = true;
        this.error = '';
        this.changeDetectorRef.markForCheck();
        try {
            this.loadingStep = 'Validando sessão...';
            this.changeDetectorRef.markForCheck();
            if (!this.authService.user()) {
                await this.request(this.authService.me());
            }
            this.loadingStep = 'Carregando workspaces...';
            this.changeDetectorRef.markForCheck();
            const response = await this.request(this.driveApi.listWorkspaces());
            this.workspaces = response.workspaces;
            this.storageOverview = response.storage;
            this.changeDetectorRef.markForCheck();
            if (this.workspaces.length > 0) {
                this.loadingStep = 'Carregando arquivos...';
                this.changeDetectorRef.markForCheck();
                await this.selectWorkspace(this.workspaces[0]);
            }
        } catch (error: unknown) {
            if (this.isUnauthorized(error)) {
                await this.router.navigateByUrl('/login');
                return;
            }
            this.selectedWorkspace = null;
            this.listing = null;
            this.error = this.readError(error);
            this.changeDetectorRef.markForCheck();
        } finally {
            this.loading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    toggleWorkspaceForm(): void {
        this.workspaceFormOpen = !this.workspaceFormOpen;
        if (this.workspaceFormOpen) {
            const maxPercent = this.availableWorkspacePercent();
            this.workspaceQuotaPercent = maxPercent > 0 ? Math.min(50, maxPercent) : 1;
        }
    }

    async createWorkspace(): Promise<void> {
        const name = this.workspaceName.trim();
        const quotaPercent = Number(this.workspaceQuotaPercent);
        const availablePercent = this.availableWorkspacePercent();
        if (!name) {
            this.error = 'Informe o nome do workspace.';
            return;
        }
        if (
            !Number.isInteger(quotaPercent) ||
            quotaPercent < 1 ||
            quotaPercent > availablePercent
        ) {
            this.error =
                availablePercent > 0
                    ? `Escolha uma quota entre 1% e ${availablePercent}% do armazenamento disponível.`
                    : 'Não há espaço livre para criar outro workspace.';
            return;
        }

        this.creatingWorkspace = true;
        this.error = '';
        try {
            const response = await firstValueFrom(
                this.driveApi.createWorkspace(name, `${quotaPercent}%`),
            );
            this.workspaces = [...this.workspaces, response.workspace].sort((left, right) =>
                left.name.localeCompare(right.name),
            );
            this.storageOverview = response.storage;
            this.workspaceName = '';
            this.workspaceQuotaPercent = Math.min(50, this.maxWorkspaceQuotaPercent());
            this.workspaceFormOpen = false;
            await this.selectWorkspace(response.workspace);
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.creatingWorkspace = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async updateWorkspaceQuota(workspace: Workspace): Promise<void> {
        if (workspace.role !== 'OWNER') {
            return;
        }
        const totalBytes = this.storageOverview.totalBytes || workspace.quotaBytes;
        const minimumPercent = Math.min(
            100,
            Math.max(1, Math.ceil((workspace.usedBytes / Math.max(1, totalBytes)) * 100)),
        );
        const maximumPercent = Math.min(
            100,
            Math.max(
                minimumPercent,
                Math.floor(
                    ((workspace.quotaBytes + this.storageOverview.availableBytes) /
                        Math.max(1, totalBytes)) *
                        100,
                ),
            ),
        );
        const currentPercent = Math.min(
            maximumPercent,
            Math.max(
                minimumPercent,
                Math.round((workspace.quotaBytes / Math.max(1, totalBytes)) * 100),
            ),
        );
        const quota = await this.modal.prompt(
            'Arraste a barra para definir a porcentagem do armazenamento total deste workspace.',
            String(currentPercent),
            'Alterar quota',
            {
                label: 'Percentual do armazenamento',
                type: 'range',
                min: minimumPercent,
                max: maximumPercent,
                step: 1,
                suffix: '%',
                required: true,
            },
        );
        if (!quota?.trim()) {
            return;
        }
        const quotaPercent = Number(quota.trim());
        if (
            !Number.isInteger(quotaPercent) ||
            quotaPercent < minimumPercent ||
            quotaPercent > maximumPercent
        ) {
            this.error = `Escolha uma quota entre ${minimumPercent}% e ${maximumPercent}%.`;
            return;
        }

        this.error = '';
        try {
            const response = await firstValueFrom(
                this.driveApi.updateWorkspaceQuota(workspace.id, `${quotaPercent}%`),
            );
            this.storageOverview = response.storage;
            this.replaceWorkspace(response.workspace);
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.changeDetectorRef.markForCheck();
        }
    }

    async updateContextWorkspaceQuota(): Promise<void> {
        const workspace = this.contextMenuWorkspace;
        this.closeContextMenu();
        if (workspace) {
            await this.updateWorkspaceQuota(workspace);
        }
    }

    async renameContextWorkspace(): Promise<void> {
        const workspace = this.contextMenuWorkspace;
        this.closeContextMenu();
        if (workspace?.role !== 'OWNER') {
            return;
        }

        const name = await this.modal.prompt(
            'Escolha o novo nome do workspace.',
            workspace.name,
            'Renomear workspace',
            {
                label: 'Nome do workspace',
                required: true,
            },
        );
        const normalizedName = name?.trim();
        if (!normalizedName || normalizedName === workspace.name) {
            return;
        }

        this.error = '';
        try {
            const response = await firstValueFrom(
                this.driveApi.renameWorkspace(workspace.id, normalizedName),
            );
            this.storageOverview = response.storage;
            this.replaceWorkspace(response.workspace);
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.changeDetectorRef.markForCheck();
        }
    }

    async selectWorkspace(workspace: Workspace): Promise<void> {
        this.selectedWorkspace = workspace;
        this.currentFolder = null;
        this.folderPath = [];
        this.membersOpen = false;
        this.members = [];
        this.memberNick = '';
        this.resetMembersScrollbar();
        this.closeContextMenu();
        this.closeShareModal();
        this.closeMoveModal();
        this.changeDetectorRef.markForCheck();
        await this.reload();
    }

    openContextMenu(event: MouseEvent, type: 'file' | 'folder', item: DriveFile | Folder): void {
        event.preventDefault();
        event.stopPropagation();
        this.contextMenuType = type;
        this.contextMenuFile = type === 'file' ? (item as DriveFile) : null;
        this.contextMenuFolder = type === 'folder' ? (item as Folder) : null;
        this.contextMenuWorkspace = null;
        const menuWidth = 210;
        const menuHeight = type === 'file' ? 220 : 205;
        this.contextMenuX = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth));
        this.contextMenuY = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight));
        this.contextMenuOpen = true;
        this.changeDetectorRef.markForCheck();
    }

    openWorkspaceContextMenu(event: MouseEvent, workspace: Workspace): void {
        if (workspace.role !== 'OWNER') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.contextMenuType = 'workspace';
        this.contextMenuFile = null;
        this.contextMenuFolder = null;
        this.contextMenuWorkspace = workspace;
        const menuWidth = 210;
        const menuHeight = 205;
        this.contextMenuX = Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth));
        this.contextMenuY = Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight));
        this.contextMenuOpen = true;
        this.changeDetectorRef.markForCheck();
    }

    openNewWorkspaceForm(): void {
        this.closeContextMenu();
        if (!this.isOwner) {
            return;
        }

        const maxPercent = this.availableWorkspacePercent();
        this.workspaceName = '';
        this.workspaceQuotaPercent = maxPercent > 0 ? Math.min(50, maxPercent) : 1;
        this.workspaceFormOpen = true;
        this.error = '';
        this.changeDetectorRef.markForCheck();
    }

    closeContextMenu(): void {
        this.contextMenuOpen = false;
        this.contextMenuType = null;
        this.contextMenuFile = null;
        this.contextMenuFolder = null;
        this.contextMenuWorkspace = null;
    }

    onMembersBackdropPointerDown(event: PointerEvent): void {
        if (event.target === event.currentTarget) {
            this.membersOpen = false;
        }
    }

    async downloadContextFile(): Promise<void> {
        const file = this.contextMenuFile;
        this.closeContextMenu();
        if (file) {
            window.open(this.driveApi.downloadUrl(file.id), '_blank', 'noopener,noreferrer');
        }
    }

    async shareFile(file: DriveFile): Promise<void> {
        this.closeContextMenu();
        this.sharingFile = file;
        this.fileShare = null;
        this.shareError = '';
        this.shareUrlCopied = false;
        this.shareOpen = true;
        this.loadingShare = true;
        this.changeDetectorRef.markForCheck();
        try {
            const response = await this.request(this.driveApi.getFileShare(file.id));
            if (this.sharingFile?.id === file.id) {
                this.fileShare = response.share;
            }
        } catch (error: unknown) {
            this.shareError = this.readError(error);
        } finally {
            this.loadingShare = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    closeShareModal(): void {
        this.shareOpen = false;
        this.sharingFile = null;
        this.fileShare = null;
        this.loadingShare = false;
        this.savingShare = false;
        this.shareUrlCopied = false;
        this.shareError = '';
    }

    onShareBackdropPointerDown(event: PointerEvent): void {
        if (event.target === event.currentTarget) {
            this.closeShareModal();
        }
    }

    async toggleFileShare(): Promise<void> {
        const file = this.sharingFile;
        const share = this.fileShare;
        if (!file || !share || this.savingShare) {
            return;
        }

        this.savingShare = true;
        this.shareError = '';
        try {
            const response = await this.request(
                this.driveApi.updateFileShare(file.id, !share.isPublic),
            );
            if (this.sharingFile?.id === file.id) {
                this.fileShare = response.share;
                this.shareUrlCopied = false;
            }
        } catch (error: unknown) {
            this.shareError = this.readError(error);
        } finally {
            this.savingShare = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async copyShareLink(): Promise<void> {
        const share = this.fileShare;
        const url = this.sharePageUrl();
        if (!share?.isPublic || !url || !navigator.clipboard) {
            this.shareError = 'O navegador não permite copiar o link de compartilhamento.';
            return;
        }

        try {
            await navigator.clipboard.writeText(url);
            this.shareUrlCopied = true;
            this.shareError = '';
        } catch (error: unknown) {
            this.shareError = this.readError(error);
        } finally {
            this.changeDetectorRef.markForCheck();
        }
    }

    sharePageUrl(): string {
        return this.fileShare?.url ?? '';
    }

    async openContextFolder(): Promise<void> {
        const folder = this.contextMenuFolder;
        this.closeContextMenu();
        if (folder) {
            await this.openFolder(folder);
        }
    }

    async openMoveFile(): Promise<void> {
        const file = this.contextMenuFile;
        const workspace = this.selectedWorkspace;
        this.closeContextMenu();
        if (!file || !workspace) {
            return;
        }

        this.movingFile = file;
        this.moveFolders = [];
        this.moveTargetFolderId = file.folderId ?? '';
        this.moveError = '';
        this.moveOpen = true;
        this.loadingMove = true;
        this.savingMove = false;
        this.changeDetectorRef.markForCheck();
        try {
            const response = await this.request(this.driveApi.listFolders(workspace.id));
            if (this.movingFile?.id === file.id) {
                this.moveFolders = response.folders;
            }
        } catch (error: unknown) {
            this.moveError = this.readError(error);
        } finally {
            this.loadingMove = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    closeMoveModal(): void {
        this.moveOpen = false;
        this.movingFile = null;
        this.moveFolders = [];
        this.moveTargetFolderId = '';
        this.loadingMove = false;
        this.savingMove = false;
        this.moveError = '';
    }

    onMoveBackdropPointerDown(event: PointerEvent): void {
        if (event.target === event.currentTarget) {
            this.closeMoveModal();
        }
    }

    async confirmMoveFile(): Promise<void> {
        const file = this.movingFile;
        if (!file || this.loadingMove || this.savingMove) {
            return;
        }

        const targetFolderId = this.moveTargetFolderId.trim() || null;
        if ((file.folderId ?? null) === targetFolderId) {
            this.closeMoveModal();
            return;
        }

        this.savingMove = true;
        this.moveError = '';
        try {
            await firstValueFrom(this.driveApi.moveFile(file.id, targetFolderId));
            this.closeMoveModal();
            await this.reload();
        } catch (error: unknown) {
            this.moveError = this.readError(error);
        } finally {
            this.savingMove = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    get moveFolderOptions(): FolderOption[] {
        const foldersById = new Map(this.moveFolders.map((folder) => [folder.id, folder]));
        return this.moveFolders
            .map((folder) => ({ folder, label: this.folderLabel(folder, foldersById) }))
            .sort((left, right) => left.label.localeCompare(right.label));
    }

    private folderLabel(folder: Folder, foldersById: Map<string, Folder>): string {
        const names = [folder.name];
        const visited = new Set([folder.id]);
        let parentId = folder.parentId;
        while (parentId && !visited.has(parentId)) {
            const parent = foldersById.get(parentId);
            if (!parent) {
                break;
            }
            names.unshift(parent.name);
            visited.add(parent.id);
            parentId = parent.parentId;
        }
        return names.join(' / ');
    }

    async renameContextItem(): Promise<void> {
        const file = this.contextMenuFile;
        const folder = this.contextMenuFolder;
        const type = this.contextMenuType;
        this.closeContextMenu();
        if (type === 'file' && file) {
            await this.renameFile(file);
            return;
        }
        if (type !== 'folder' || !folder) {
            return;
        }

        const name = await this.modal.prompt(
            'Escolha o novo nome da pasta.',
            folder.name,
            'Renomear pasta',
            {
                label: 'Nome da pasta',
                required: true,
            },
        );
        if (!name?.trim()) {
            return;
        }
        try {
            await firstValueFrom(this.driveApi.updateFolder(folder.id, name));
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        }
    }

    async deleteContextItem(): Promise<void> {
        const file = this.contextMenuFile;
        const folder = this.contextMenuFolder;
        const type = this.contextMenuType;
        this.closeContextMenu();
        if (type === 'file' && file) {
            await this.deleteFile(file);
            return;
        }
        if (type !== 'folder' || !folder) {
            return;
        }
        if (!(await this.modal.confirm(`Excluir a pasta “${folder.name}”?`, 'Excluir pasta'))) {
            return;
        }

        let recursive = false;
        try {
            if (!this.selectedWorkspace) {
                return;
            }

            const contents = await this.request(
                this.driveApi.listFiles(this.selectedWorkspace.id, folder.id),
            );
            const fileCount = contents.files.length;
            const folderCount = contents.folders.length;
            if (fileCount > 0 || folderCount > 0) {
                const contentSummary = [
                    fileCount > 0 ? `${fileCount} ${fileCount === 1 ? 'arquivo' : 'arquivos'}` : '',
                    folderCount > 0
                        ? `${folderCount} ${folderCount === 1 ? 'subpasta' : 'subpastas'}`
                        : '',
                ]
                    .filter(Boolean)
                    .join(' e ');
                if (
                    !(await this.modal.confirm(
                        `A pasta “${folder.name}” contém ${contentSummary}. Se continuar, todo esse conteúdo será excluído permanentemente. Tem certeza?`,
                        'A pasta contém conteúdo',
                    ))
                ) {
                    return;
                }
                recursive = true;
            }

            await firstValueFrom(this.driveApi.deleteFolder(folder.id, recursive));
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        }
    }

    async toggleMembers(): Promise<void> {
        if (this.selectedWorkspace?.role !== 'OWNER') {
            return;
        }
        this.membersOpen = !this.membersOpen;
        this.error = '';
        if (this.membersOpen) {
            this.scheduleMembersScrollbarSync();
            await this.loadMembers(this.selectedWorkspace.id);
        }
    }

    async addWorkspaceMember(): Promise<void> {
        const workspace = this.selectedWorkspace;
        const nick = this.memberNick.trim();
        if (workspace?.role !== 'OWNER' || !nick) {
            return;
        }

        this.savingMember = true;
        this.error = '';
        try {
            const response = await firstValueFrom(
                this.driveApi.addWorkspaceMember(workspace.id, nick),
            );
            this.members = [...this.members, response.member].sort((left, right) =>
                left.nick.localeCompare(right.nick),
            );
            this.memberNick = '';
            this.scheduleMembersScrollbarSync();
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.savingMember = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async removeWorkspaceMember(member: WorkspaceMember): Promise<void> {
        const workspace = this.selectedWorkspace;
        if (workspace?.role !== 'OWNER' || member.role === 'OWNER') {
            return;
        }
        if (
            !(await this.modal.confirm(`Remover o acesso de “${member.nick}”?`, 'Remover membro'))
        ) {
            return;
        }

        this.savingMember = true;
        this.error = '';
        try {
            await firstValueFrom(this.driveApi.removeWorkspaceMember(workspace.id, member.userId));
            this.members = this.members.filter(
                (currentMember) => currentMember.userId !== member.userId,
            );
            this.scheduleMembersScrollbarSync();
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.savingMember = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async openFolder(folder: Folder): Promise<void> {
        this.closeContextMenu();
        const existingIndex = this.folderPath.findIndex(
            (currentFolder) => currentFolder.id === folder.id,
        );
        this.folderPath =
            existingIndex >= 0
                ? this.folderPath.slice(0, existingIndex + 1)
                : [...this.folderPath, folder];
        this.currentFolder = folder;
        await this.reload();
    }

    async goToRoot(): Promise<void> {
        this.closeContextMenu();
        this.folderPath = [];
        this.currentFolder = null;
        await this.reload();
    }

    async goToBreadcrumb(index: number): Promise<void> {
        this.closeContextMenu();
        if (index < 0) {
            await this.goToRoot();
            return;
        }

        const folder = this.folderPath[index];
        if (!folder) {
            return;
        }
        this.folderPath = this.folderPath.slice(0, index + 1);
        this.currentFolder = folder;
        await this.reload();
    }

    async goToParent(): Promise<void> {
        if (!this.currentFolder) {
            return;
        }
        await this.goToBreadcrumb(this.folderPath.length - 2);
    }

    parentDropTargetId(): string | null {
        return this.folderPath.length > 1
            ? (this.folderPath[this.folderPath.length - 2]?.id ?? null)
            : null;
    }

    parentFolderName(): string {
        return this.folderPath.length > 1
            ? (this.folderPath[this.folderPath.length - 2]?.name ?? 'Arquivos')
            : 'Arquivos';
    }

    isDropTarget(folderId: string | null): boolean {
        return this.dragOverDropTarget === this.dropTargetKey(folderId);
    }

    onFileDragStart(event: DragEvent, file: DriveFile): void {
        this.draggedFile = file;
        this.dragOverDropTarget = null;
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', file.id);
        }
    }

    onFileDragEnd(): void {
        this.clearFileDragState();
    }

    onFileDragOver(event: DragEvent, folderId: string | null): void {
        if (!this.draggedFile || !this.canDropFileInto(folderId) || this.movingDraggedFile) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
        this.dragOverDropTarget = this.dropTargetKey(folderId);
    }

    onFileDragLeave(event: DragEvent, folderId: string | null): void {
        const currentTarget = event.currentTarget as HTMLElement | null;
        const relatedTarget = event.relatedTarget as Node | null;
        if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
            return;
        }
        if (this.isDropTarget(folderId)) {
            this.dragOverDropTarget = null;
        }
    }

    async onFileDrop(event: DragEvent, folderId: string | null): Promise<void> {
        event.preventDefault();
        event.stopPropagation();
        const file = this.draggedFile;
        const canDrop = this.canDropFileInto(folderId);
        this.clearFileDragState();
        if (!file || !canDrop) {
            return;
        }
        await this.moveFileByDrop(file, folderId);
    }

    private canDropFileInto(folderId: string | null): boolean {
        return Boolean(this.draggedFile && (this.draggedFile.folderId ?? null) !== folderId);
    }

    private dropTargetKey(folderId: string | null): string {
        return folderId ?? '__root__';
    }

    private clearFileDragState(): void {
        this.draggedFile = null;
        this.dragOverDropTarget = null;
    }

    private async moveFileByDrop(file: DriveFile, folderId: string | null): Promise<void> {
        if (!this.selectedWorkspace || this.movingDraggedFile) {
            return;
        }

        this.movingDraggedFile = true;
        this.error = '';
        try {
            await firstValueFrom(this.driveApi.moveFile(file.id, folderId));
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.movingDraggedFile = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async createFolder(): Promise<void> {
        if (!this.selectedWorkspace || !this.folderName.trim()) {
            return;
        }
        try {
            await firstValueFrom(
                this.driveApi.createFolder(
                    this.selectedWorkspace.id,
                    this.folderName,
                    this.currentFolder?.id ?? null,
                ),
            );
            this.folderName = '';
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        }
    }

    async upload(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file || !this.selectedWorkspace) {
            return;
        }
        this.uploading = true;
        this.uploadProgress = 0;
        this.uploadFileName = file.name;
        this.error = '';
        this.changeDetectorRef.markForCheck();
        try {
            await lastValueFrom(
                this.driveApi
                    .upload(this.selectedWorkspace.id, this.currentFolder?.id ?? null, file)
                    .pipe(
                        tap((event) => {
                            if (event.type === HttpEventType.UploadProgress && event.total) {
                                this.uploadProgress = Math.round(
                                    (event.loaded / event.total) * 100,
                                );
                                this.changeDetectorRef.markForCheck();
                            }
                        }),
                    ),
            );
            input.value = '';
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.uploading = false;
            this.uploadProgress = 0;
            this.uploadFileName = '';
            this.changeDetectorRef.markForCheck();
        }
    }

    async renameFile(file: DriveFile): Promise<void> {
        const extension = file.extension || this.detectFileExtension(file.originalName);
        const name = await this.modal.prompt(
            extension
                ? `Escolha o novo nome do arquivo. A extensão ${extension} será mantida.`
                : 'Escolha o novo nome do arquivo.',
            this.removeFileExtension(file.originalName, extension),
            'Renomear arquivo',
            {
                label: extension ? 'Nome do arquivo (sem extensão)' : 'Nome do arquivo',
                suffix: extension || undefined,
                required: true,
            },
        );
        if (!name?.trim()) {
            return;
        }
        try {
            await firstValueFrom(this.driveApi.renameFile(file.id, name, extension));
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        }
    }

    private detectFileExtension(value: string): string {
        const lastDot = value.lastIndexOf('.');
        if (lastDot <= 0 || lastDot === value.length - 1) {
            return '';
        }
        return value.slice(lastDot);
    }

    private removeFileExtension(value: string, extension: string): string {
        return extension && value.endsWith(extension) ? value.slice(0, -extension.length) : value;
    }

    async deleteFile(file: DriveFile): Promise<void> {
        if (!(await this.modal.confirm(`Excluir “${file.originalName}”?`, 'Excluir arquivo'))) {
            return;
        }
        try {
            await firstValueFrom(this.driveApi.deleteFile(file.id));
            await this.reload();
        } catch (error: unknown) {
            this.error = this.readError(error);
        }
    }

    async logout(): Promise<void> {
        await firstValueFrom(this.authService.logout());
        await this.router.navigateByUrl('/login');
    }

    formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        if (bytes < 1024 * 1024 * 1024 * 1024)
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    }

    usagePercent(workspace: Workspace): number {
        return workspace.quotaBytes > 0
            ? Math.min(100, (workspace.usedBytes / workspace.quotaBytes) * 100)
            : 0;
    }

    allocatedPercent(): number {
        return this.storageOverview.totalBytes > 0
            ? Math.min(
                  100,
                  (this.storageOverview.allocatedBytes / this.storageOverview.totalBytes) * 100,
              )
            : 0;
    }

    availableWorkspacePercent(): number {
        return this.storageOverview.totalBytes > 0
            ? Math.max(
                  0,
                  Math.min(
                      100,
                      Math.floor(
                          (this.storageOverview.availableBytes / this.storageOverview.totalBytes) *
                              100,
                      ),
                  ),
              )
            : 0;
    }

    maxWorkspaceQuotaPercent(): number {
        return Math.max(1, this.availableWorkspacePercent());
    }

    hasAvailableWorkspaceSpace(): boolean {
        return this.availableWorkspacePercent() >= 1;
    }

    workspaceQuotaBytes(): number {
        const percent = Math.max(0, Math.min(100, Number(this.workspaceQuotaPercent) || 0));
        return Math.floor((this.storageOverview.totalBytes * percent) / 100);
    }

    private async reload(): Promise<void> {
        if (!this.selectedWorkspace) {
            return;
        }
        this.error = '';
        this.listing = await this.request(
            this.driveApi.listFiles(this.selectedWorkspace.id, this.currentFolder?.id ?? null),
        );
        this.workspaces = this.workspaces.map((workspace) =>
            workspace.id === this.selectedWorkspace?.id
                ? {
                      ...workspace,
                      quotaBytes: this.listing?.storage.quotaBytes ?? workspace.quotaBytes,
                      usedBytes: this.listing?.storage.usedBytes ?? workspace.usedBytes,
                      availableBytes:
                          this.listing?.storage.availableBytes ?? workspace.availableBytes,
                  }
                : workspace,
        );
        this.selectedWorkspace =
            this.workspaces.find((workspace) => workspace.id === this.selectedWorkspace?.id) ??
            null;
        this.changeDetectorRef.markForCheck();
    }

    private replaceWorkspace(updatedWorkspace: Workspace): void {
        this.workspaces = this.workspaces
            .map((workspace) =>
                workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace,
            )
            .sort((left, right) => left.name.localeCompare(right.name));
        if (this.selectedWorkspace?.id === updatedWorkspace.id) {
            this.selectedWorkspace = updatedWorkspace;
        }
    }

    private async loadMembers(workspaceId: string): Promise<void> {
        this.loadingMembers = true;
        this.members = [];
        try {
            const response = await this.request(this.driveApi.listWorkspaceMembers(workspaceId));
            if (this.selectedWorkspace?.id === workspaceId) {
                this.members = response.members;
                this.scheduleMembersScrollbarSync();
            }
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.loadingMembers = false;
            this.scheduleMembersScrollbarSync();
            this.changeDetectorRef.markForCheck();
        }
    }

    syncMembersScrollbar(): void {
        const viewport = this.membersModalViewport?.nativeElement;
        if (!viewport) {
            return;
        }

        const scrollRange = viewport.scrollHeight - viewport.clientHeight;
        if (scrollRange <= 1) {
            this.membersScrollbarVisible = false;
            this.membersScrollbarThumbHeight = 0;
            this.membersScrollbarThumbOffset = 0;
            this.changeDetectorRef.markForCheck();
            return;
        }

        const trackHeight = Math.max(1, viewport.clientHeight - 24);
        const thumbHeight = Math.min(
            trackHeight,
            Math.max(34, (viewport.clientHeight / viewport.scrollHeight) * trackHeight),
        );
        const thumbRange = Math.max(0, trackHeight - thumbHeight);
        this.membersScrollbarVisible = true;
        this.membersScrollbarThumbHeight = thumbHeight;
        this.membersScrollbarThumbOffset = thumbRange * (viewport.scrollTop / scrollRange);
        this.changeDetectorRef.markForCheck();
    }

    onMembersModalWheel(event: WheelEvent): void {
        const viewport = this.membersModalViewport?.nativeElement;
        if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        viewport.scrollTop += event.deltaY;
        this.syncMembersScrollbar();
    }

    onMembersScrollbarKeydown(event: KeyboardEvent): void {
        const viewport = this.membersModalViewport?.nativeElement;
        if (!viewport) {
            return;
        }

        const pageSize = viewport.clientHeight * 0.85;
        const movements: Record<string, number> = {
            ArrowDown: 48,
            ArrowUp: -48,
            PageDown: pageSize,
            PageUp: -pageSize,
            End: viewport.scrollHeight,
            Home: -viewport.scrollHeight,
        };
        const movement = movements[event.key];
        if (movement === undefined) {
            return;
        }

        event.preventDefault();
        viewport.scrollTop += movement;
        this.syncMembersScrollbar();
    }

    onMembersScrollbarTrackClick(event: MouseEvent): void {
        if (!this.membersScrollbarVisible || event.target !== event.currentTarget) {
            return;
        }
        const viewport = this.membersModalViewport?.nativeElement;
        const track = event.currentTarget as HTMLElement;
        if (!viewport || track.clientHeight <= 0) {
            return;
        }

        const bounds = track.getBoundingClientRect();
        const position = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
        viewport.scrollTop =
            position * (viewport.scrollHeight - viewport.clientHeight) - viewport.clientHeight / 2;
        this.syncMembersScrollbar();
    }

    startMembersScrollbarDrag(event: MouseEvent): void {
        const viewport = this.membersModalViewport?.nativeElement;
        if (!viewport || !this.membersScrollbarVisible) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const startY = event.clientY;
        const startScrollTop = viewport.scrollTop;
        const scrollRange = viewport.scrollHeight - viewport.clientHeight;
        const thumbRange = Math.max(
            1,
            viewport.clientHeight - 24 - this.membersScrollbarThumbHeight,
        );

        const onMove = (moveEvent: MouseEvent): void => {
            const movement = moveEvent.clientY - startY;
            viewport.scrollTop = startScrollTop + (movement / thumbRange) * scrollRange;
            this.syncMembersScrollbar();
        };
        const stop = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', stop);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', stop);
    }

    private scheduleMembersScrollbarSync(): void {
        requestAnimationFrame(() => this.syncMembersScrollbar());
    }

    private resetMembersScrollbar(): void {
        this.membersScrollbarVisible = false;
        this.membersScrollbarThumbHeight = 0;
        this.membersScrollbarThumbOffset = 0;
    }

    private request<T>(source: Observable<T>): Promise<T> {
        return firstValueFrom(source.pipe(timeout({ each: 10000 })));
    }

    private isUnauthorized(error: unknown): boolean {
        const response = error as { status?: number };
        return response.status === 401;
    }

    private readError(error: unknown): string {
        const response = error as { error?: { message?: string | string[] }; message?: string };
        const message = response.error?.message;
        if (!message && response.message) {
            return response.message;
        }
        return Array.isArray(message)
            ? message.join(', ')
            : message || 'Não foi possível concluir a operação.';
    }
}
