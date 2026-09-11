import { computed, Injectable, signal } from '@angular/core';

const serverUrlStorageKey = 'fast-drive.server-url';

function isTauriRuntime(): boolean {
    return (
        typeof window !== 'undefined' &&
        ('__TAURI_INTERNALS__' in window || navigator.userAgent.toLowerCase().includes('tauri'))
    );
}

export function normalizeServerUrl(value: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        throw new Error('Informe o endereço da aplicação.');
    }

    const inputUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue)
        ? trimmedValue
        : `https://${trimmedValue}`;
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(inputUrl);
    } catch {
        throw new Error('Informe um endereço válido, como https://drive.exemplo.com.');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('O endereço deve começar com http:// ou https://.');
    }

    if (parsedUrl.username || parsedUrl.password) {
        throw new Error('O endereço não pode conter usuário ou senha.');
    }

    if (parsedUrl.search || parsedUrl.hash) {
        throw new Error('O endereço não pode conter parâmetros ou fragmentos.');
    }

    return parsedUrl.toString().replace(/\/+$/, '');
}

function readStoredServerUrl(): string | null {
    try {
        const storedValue = localStorage.getItem(serverUrlStorageKey);
        return storedValue ? normalizeServerUrl(storedValue) : null;
    } catch {
        return null;
    }
}

@Injectable({ providedIn: 'root' })
export class ServerConfigService {
    readonly isDesktop = isTauriRuntime();

    private readonly configuredUrl = signal<string | null>(readStoredServerUrl());

    readonly serverUrl = this.configuredUrl.asReadonly();
    readonly requiresSetup = computed(() => this.isDesktop && !this.configuredUrl());

    get apiBaseUrl(): string {
        return this.configuredUrl() ?? '';
    }

    apiUrl(path: string): string {
        if (!path.startsWith('/api/')) {
            return path;
        }

        return this.apiBaseUrl ? `${this.apiBaseUrl}${path}` : path;
    }

    async validate(value: string): Promise<string> {
        const normalizedUrl = normalizeServerUrl(value);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8_000);

        try {
            const response = await fetch(`${normalizedUrl}/api/health`, {
                signal: controller.signal,
                credentials: 'include',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });

            if (!response.ok) {
                throw new Error(`O endereço respondeu com HTTP ${response.status}.`);
            }

            return normalizedUrl;
        } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error('A conexão demorou muito para responder.');
            }
            if (error instanceof Error && error.message.startsWith('O endereço respondeu')) {
                throw error;
            }
            throw new Error(
                'Não foi possível conectar. Verifique o endereço, a rede e a configuração de CORS.',
            );
        } finally {
            window.clearTimeout(timeout);
        }
    }

    save(value: string): string {
        const normalizedUrl = normalizeServerUrl(value);
        localStorage.setItem(serverUrlStorageKey, normalizedUrl);
        this.configuredUrl.set(normalizedUrl);
        return normalizedUrl;
    }

    clear(): void {
        localStorage.removeItem(serverUrlStorageKey);
        this.configuredUrl.set(null);
    }
}
