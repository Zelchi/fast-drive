import { describe, expect, it } from 'vitest';
import {
    generateOpaqueToken,
    generateSerial,
    hashSecret,
    hashSessionToken,
    verifySecret,
} from '../src/routes/auth/auth.crypto';

describe('authentication cryptography', () => {
    it('hashes secrets and verifies only the original value', async () => {
        const encoded = await hashSecret('correct horse battery staple');

        expect(encoded).toMatch(/^scrypt\$v1\$[^$]+\$[^$]+$/);
        await expect(verifySecret('correct horse battery staple', encoded)).resolves.toBe(true);
        await expect(verifySecret('wrong password', encoded)).resolves.toBe(false);
    });

    it('does not accept malformed encoded secrets', async () => {
        await expect(verifySecret('anything', '')).resolves.toBe(false);
        await expect(verifySecret('anything', 'sha256$v1$salt$hash')).resolves.toBe(false);
        await expect(verifySecret('anything', 'scrypt$v1$invalid$')).resolves.toBe(false);
    });

    it('generates opaque tokens and serials with the expected format', () => {
        const token = generateOpaqueToken();
        const serial = generateSerial();

        expect(token).toHaveLength(43);
        expect(serial).toMatch(/^FD-[A-F0-9]{36}$/);
        expect(generateOpaqueToken()).not.toBe(token);
    });

    it('hashes the same session token deterministically', () => {
        const firstHash = hashSessionToken('session-token');

        expect(firstHash).toHaveLength(64);
        expect(hashSessionToken('session-token')).toBe(firstHash);
        expect(hashSessionToken('another-token')).not.toBe(firstHash);
    });
});
