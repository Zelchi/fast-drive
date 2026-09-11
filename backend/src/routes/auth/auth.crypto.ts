import { createHash, randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';

const derivedKeyLength = 64;
const scryptOptions: ScryptOptions = {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
};

function scryptAsync(
    secret: string,
    salt: Buffer,
    keyLength: number,
    options: ScryptOptions,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(secret, salt, keyLength, options, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(derivedKey);
        });
    });
}

export async function hashSecret(secret: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await scryptAsync(secret, salt, derivedKeyLength, scryptOptions);
    return `scrypt$v1$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
    const [algorithm, version, encodedSalt, encodedHash] = encoded.split('$');
    if (algorithm !== 'scrypt' || version !== 'v1' || !encodedSalt || !encodedHash) {
        return false;
    }

    try {
        const salt = Buffer.from(encodedSalt, 'base64url');
        const expectedHash = Buffer.from(encodedHash, 'base64url');
        const actualHash = await scryptAsync(secret, salt, expectedHash.length, scryptOptions);
        return (
            actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash)
        );
    } catch {
        return false;
    }
}

export function generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
}

export function generateSerial(): string {
    return `FD-${randomBytes(18).toString('hex').toUpperCase()}`;
}

export function hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
