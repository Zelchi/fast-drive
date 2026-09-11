import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { DriveApiService, type PublicShareMetadata } from '../../core/drive-api.service';

@Component({
    standalone: true,
    imports: [CommonModule],
    selector: 'app-share-page',
    templateUrl: './share-page.component.html',
    styleUrl: './share-page.component.css',
})
export class SharePageComponent implements OnInit {
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly driveApi = inject(DriveApiService);
    private readonly sanitizer = inject(DomSanitizer);

    share: PublicShareMetadata | null = null;
    pdfPreviewUrl: SafeResourceUrl | null = null;
    markdownContent = '';
    markdownLoading = false;
    markdownError = '';
    audioPlaying = false;
    audioCurrentTime = 0;
    audioDuration = 0;
    audioVolume = 1;
    audioError = '';
    token = '';
    loading = true;
    error = '';
    private audioSeekPointerId: number | null = null;
    private audioVolumePointerId: number | null = null;

    async ngOnInit(): Promise<void> {
        this.token = window.location.pathname.split('/').filter(Boolean).at(-1) ?? '';
        await this.loadShare();
    }

    async retry(): Promise<void> {
        await this.loadShare();
    }

    get isImage(): boolean {
        const mimeType = this.share?.mimeType.toLowerCase() ?? '';
        return (
            mimeType.startsWith('image/') ||
            ['.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'].includes(
                this.fileExtension,
            )
        );
    }

    get isVideo(): boolean {
        const mimeType = this.share?.mimeType.toLowerCase() ?? '';
        return (
            mimeType.startsWith('video/') ||
            ['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.ogv', '.webm'].includes(this.fileExtension)
        );
    }

    get isAudio(): boolean {
        const mimeType = this.share?.mimeType.toLowerCase() ?? '';
        return (
            mimeType.startsWith('audio/') ||
            ['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.weba'].includes(
                this.fileExtension,
            )
        );
    }

    get isPdf(): boolean {
        return (
            this.share?.mimeType.toLowerCase() === 'application/pdf' ||
            this.fileExtension === '.pdf'
        );
    }

    get isMarkdown(): boolean {
        const mimeType = this.share?.mimeType.toLowerCase() ?? '';
        return mimeType === 'text/markdown' || ['.md', '.markdown'].includes(this.fileExtension);
    }

    get mediaLabel(): string {
        if (this.isImage) {
            return 'Imagem';
        }
        if (this.isVideo) {
            return 'Vídeo';
        }
        if (this.isAudio) {
            return 'Áudio';
        }
        if (this.isPdf) {
            return 'PDF';
        }
        if (this.isMarkdown) {
            return 'Markdown';
        }
        return 'Arquivo';
    }

    get previewUrl(): string {
        return this.token ? this.driveApi.publicShareContentUrl(this.token) : '';
    }

    get downloadUrl(): string {
        return this.token ? this.driveApi.publicShareDownloadUrl(this.token) : '';
    }

    get audioProgress(): number {
        return this.audioDuration > 0
            ? Math.min(100, (this.audioCurrentTime / this.audioDuration) * 100)
            : 0;
    }

    get audioVolumeLabel(): string {
        return `${Math.round(this.audioVolume * 100)}%`;
    }

    private get fileExtension(): string {
        const extension = this.share?.extension.trim().toLowerCase() ?? '';
        if (extension) {
            return extension.startsWith('.') ? extension : `.${extension}`;
        }

        const originalName = this.share?.originalName.toLowerCase() ?? '';
        const dotIndex = originalName.lastIndexOf('.');
        return dotIndex > 0 ? originalName.slice(dotIndex) : '';
    }

    formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        if (bytes < 1024 * 1024 * 1024 * 1024)
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    }

    formatAudioTime(seconds: number): string {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return '00:00';
        }

        const totalSeconds = Math.floor(seconds);
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        if (minutes >= 60) {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    toggleAudio(audio: HTMLAudioElement): void {
        this.audioError = '';
        if (audio.paused) {
            void audio.play().catch(() => {
                this.audioPlaying = false;
                this.audioError = 'Não foi possível reproduzir este áudio.';
            });
            return;
        }
        audio.pause();
    }

    onAudioMetadata(audio: HTMLAudioElement): void {
        this.updateAudioDuration(audio);
        this.audioCurrentTime = 0;
        this.audioError = '';
    }

    onAudioDurationChange(audio: HTMLAudioElement): void {
        this.updateAudioDuration(audio);
    }

    onAudioTimeUpdate(audio: HTMLAudioElement): void {
        this.audioCurrentTime = audio.currentTime;
    }

    onAudioPlay(): void {
        this.audioPlaying = true;
    }

    onAudioPause(): void {
        this.audioPlaying = false;
    }

    onAudioEnded(): void {
        this.audioPlaying = false;
        this.audioCurrentTime = this.audioDuration;
    }

    private updateAudioDuration(audio: HTMLAudioElement): void {
        const mediaDuration = audio.duration;
        const seekableDuration =
            audio.seekable.length > 0 ? audio.seekable.end(audio.seekable.length - 1) : 0;
        const duration =
            Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : seekableDuration;

        if (Number.isFinite(duration) && duration > 0) {
            this.audioDuration = duration;
            this.audioCurrentTime = Math.min(this.audioCurrentTime, duration);
            this.changeDetectorRef.markForCheck();
        }
    }

    beginAudioSeek(audio: HTMLAudioElement, event: PointerEvent): void {
        const slider = event.currentTarget as HTMLElement;
        if (this.audioDuration <= 0) {
            return;
        }

        this.audioSeekPointerId = event.pointerId;
        slider.setPointerCapture(event.pointerId);
        this.setAudioPositionFromPointer(audio, slider, event.clientX);
    }

    moveAudioSeek(audio: HTMLAudioElement, event: PointerEvent): void {
        if (this.audioSeekPointerId !== event.pointerId) {
            return;
        }

        this.setAudioPositionFromPointer(audio, event.currentTarget as HTMLElement, event.clientX);
    }

    endAudioSeek(event: PointerEvent): void {
        if (this.audioSeekPointerId !== event.pointerId) {
            return;
        }

        const slider = event.currentTarget as HTMLElement;
        if (slider.hasPointerCapture(event.pointerId)) {
            slider.releasePointerCapture(event.pointerId);
        }
        this.audioSeekPointerId = null;
    }

    onAudioSeekKeydown(audio: HTMLAudioElement, event: KeyboardEvent): void {
        if (this.audioDuration <= 0) {
            return;
        }

        const step = event.shiftKey ? 10 : 5;
        let nextValue: number | null = null;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            nextValue = this.audioCurrentTime - step;
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            nextValue = this.audioCurrentTime + step;
        } else if (event.key === 'Home') {
            nextValue = 0;
        } else if (event.key === 'End') {
            nextValue = this.audioDuration;
        }

        if (nextValue === null) {
            return;
        }

        event.preventDefault();
        this.setAudioPosition(audio, nextValue);
    }

    private setAudioPositionFromPointer(
        audio: HTMLAudioElement,
        slider: HTMLElement,
        clientX: number,
    ): void {
        const bounds = slider.getBoundingClientRect();
        const min = 0;
        const max = this.audioDuration;
        if (bounds.width <= 0 || !Number.isFinite(max) || max <= min) {
            return;
        }

        const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
        this.setAudioPosition(audio, min + (max - min) * ratio);
    }

    private setAudioPosition(audio: HTMLAudioElement, value: number): void {
        if (!Number.isFinite(value) || this.audioDuration <= 0) {
            return;
        }

        const nextValue = Math.max(0, Math.min(this.audioDuration, value));
        try {
            audio.currentTime = nextValue;
        } catch {
            return;
        }
        this.audioCurrentTime = nextValue;
        this.changeDetectorRef.markForCheck();
    }

    beginAudioVolume(audio: HTMLAudioElement, event: PointerEvent): void {
        const slider = event.currentTarget as HTMLElement;
        this.audioVolumePointerId = event.pointerId;
        slider.setPointerCapture(event.pointerId);
        this.setAudioVolumeFromPointer(audio, slider, event.clientX);
    }

    moveAudioVolume(audio: HTMLAudioElement, event: PointerEvent): void {
        if (this.audioVolumePointerId !== event.pointerId) {
            return;
        }

        this.setAudioVolumeFromPointer(audio, event.currentTarget as HTMLElement, event.clientX);
    }

    endAudioVolume(event: PointerEvent): void {
        if (this.audioVolumePointerId !== event.pointerId) {
            return;
        }

        const slider = event.currentTarget as HTMLElement;
        if (slider.hasPointerCapture(event.pointerId)) {
            slider.releasePointerCapture(event.pointerId);
        }
        this.audioVolumePointerId = null;
    }

    onAudioVolumeKeydown(audio: HTMLAudioElement, event: KeyboardEvent): void {
        const step = event.shiftKey ? 0.1 : 0.05;
        let nextValue: number | null = null;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            nextValue = this.audioVolume - step;
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            nextValue = this.audioVolume + step;
        } else if (event.key === 'Home') {
            nextValue = 0;
        } else if (event.key === 'End') {
            nextValue = 1;
        }

        if (nextValue === null) {
            return;
        }

        event.preventDefault();
        this.setAudioVolumeValue(audio, nextValue);
    }

    private setAudioVolumeFromPointer(
        audio: HTMLAudioElement,
        slider: HTMLElement,
        clientX: number,
    ): void {
        const bounds = slider.getBoundingClientRect();
        if (bounds.width <= 0) {
            return;
        }

        const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
        this.setAudioVolumeValue(audio, ratio);
    }

    private setAudioVolumeValue(audio: HTMLAudioElement, value: number): void {
        if (!Number.isFinite(value)) {
            return;
        }

        const nextValue = Math.max(0, Math.min(1, value));
        audio.volume = nextValue;
        this.audioVolume = nextValue;
        this.changeDetectorRef.markForCheck();
    }

    private async loadShare(): Promise<void> {
        this.loading = true;
        this.error = '';
        this.share = null;
        this.pdfPreviewUrl = null;
        this.markdownContent = '';
        this.markdownLoading = false;
        this.markdownError = '';
        this.audioPlaying = false;
        this.audioCurrentTime = 0;
        this.audioDuration = 0;
        this.audioVolume = 1;
        this.audioError = '';
        this.audioSeekPointerId = null;
        this.audioVolumePointerId = null;
        this.changeDetectorRef.markForCheck();

        if (!this.token) {
            this.error = 'Este link de compartilhamento está incompleto.';
            this.loading = false;
            this.changeDetectorRef.markForCheck();
            return;
        }

        try {
            this.share = await firstValueFrom(this.driveApi.getPublicShareMetadata(this.token));
            this.pdfPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.previewUrl);
            if (this.isMarkdown) {
                await this.loadMarkdown();
            }
        } catch (error: unknown) {
            this.error = this.readError(error);
        } finally {
            this.loading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    private async loadMarkdown(): Promise<void> {
        this.markdownLoading = true;
        this.markdownError = '';
        this.changeDetectorRef.markForCheck();

        try {
            this.markdownContent = await firstValueFrom(
                this.driveApi.getPublicShareContent(this.token),
            );
        } catch (error: unknown) {
            this.markdownError = this.readError(error);
        } finally {
            this.markdownLoading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    private readError(error: unknown): string {
        const response = error as { error?: { message?: string | string[] } };
        const message = response.error?.message;
        return Array.isArray(message)
            ? message.join(', ')
            : message || 'Este arquivo não está disponível.';
    }
}
