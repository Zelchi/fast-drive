import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { normalizeServerUrl, ServerConfigService } from '../../core/server-config.service';

@Component({
    standalone: true,
    imports: [FormsModule],
    selector: 'app-server-setup',
    templateUrl: './server-setup.component.html',
    styleUrl: './server-setup.component.css',
})
export class ServerSetupComponent {
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly serverConfig = inject(ServerConfigService);

    serverUrl = this.serverConfig.serverUrl() ?? 'http://127.0.0.1:7000';
    loading = false;
    error = '';

    normalizeAddress(): void {
        if (!this.serverUrl.trim()) {
            return;
        }

        try {
            this.serverUrl = normalizeServerUrl(this.serverUrl);
        } catch {
            // A detailed validation message is shown only when the user submits the form.
        }
    }

    async connect(): Promise<void> {
        if (this.loading) {
            return;
        }

        this.loading = true;
        this.error = '';

        try {
            const validatedUrl = await this.serverConfig.validate(this.serverUrl);
            this.serverUrl = validatedUrl;
            this.serverConfig.save(validatedUrl);
        } catch (error: unknown) {
            this.error = error instanceof Error ? error.message : 'Não foi possível conectar.';
        } finally {
            this.loading = false;
            this.changeDetectorRef.markForCheck();
        }
    }
}
