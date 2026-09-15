import { Injectable, inject } from '@angular/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { ServerConfigService } from './server-config.service';

export interface DesktopUpdateProgress {
    downloaded: number;
    contentLength?: number;
}

@Injectable({ providedIn: 'root' })
export class DesktopUpdateService {
    private readonly serverConfig = inject(ServerConfigService);

    get isDesktop(): boolean {
        return this.serverConfig.isDesktop;
    }

    async checkForUpdates(
        onProgress?: (progress: DesktopUpdateProgress) => void,
    ): Promise<string | null> {
        if (!this.isDesktop) {
            throw new Error('As atualizações só estão disponíveis no aplicativo desktop.');
        }

        const update = await check({ timeout: 10_000 });
        if (!update) {
            return null;
        }

        let downloaded = 0;
        let contentLength: number | undefined;

        const reportProgress = (): void => {
            onProgress?.({ downloaded, contentLength });
        };

        await update.downloadAndInstall((event: DownloadEvent) => {
            if (event.event === 'Started') {
                contentLength = event.data.contentLength;
                downloaded = 0;
            } else if (event.event === 'Progress') {
                downloaded += event.data.chunkLength;
            }
            reportProgress();
        }, { timeout: 120_000, restartAfterInstall: true });

        await relaunch();
        return update.version;
    }
}
