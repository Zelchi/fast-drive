import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, ServerConfigService } from '../src/app/core/server-config.service';

describe('server configuration', () => {
    it('normalizes the configured server address', () => {
        expect(normalizeServerUrl('  https://drive.example.com///  ')).toBe(
            'https://drive.example.com',
        );
    });

    it('adds HTTPS when the address has no protocol', () => {
        expect(normalizeServerUrl('drive.example.com')).toBe('https://drive.example.com');
        expect(normalizeServerUrl('drive.example.com:7000')).toBe('https://drive.example.com:7000');
    });

    it('rejects addresses that cannot be used as an API origin', () => {
        expect(() => normalizeServerUrl('ftp://drive.example.com')).toThrow();
        expect(() => normalizeServerUrl('https://user:password@drive.example.com')).toThrow();
        expect(() => normalizeServerUrl('https://drive.example.com?target=other')).toThrow();
    });

    it('keeps relative API paths in the browser and prefixes them when configured', () => {
        const serverConfig = new ServerConfigService();

        expect(serverConfig.apiUrl('/api/health')).toBe('/api/health');

        serverConfig.save('https://drive.example.com/');
        expect(serverConfig.apiUrl('/api/health')).toBe('https://drive.example.com/api/health');
        expect(serverConfig.apiUrl('/assets/icon.svg')).toBe('/assets/icon.svg');
        serverConfig.clear();
    });
});
