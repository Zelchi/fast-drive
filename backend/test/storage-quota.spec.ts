import { describe, expect, it } from 'vitest';
import {
    defaultStorageQuota,
    getStorageQuota,
    parseByteSize,
    parseWorkspaceQuota,
} from '../src/storage/storage-quota';

describe('storage quota helpers', () => {
    it('parses byte values with decimal and binary units', () => {
        expect(parseByteSize('512', 'quota')).toBe(512);
        expect(parseByteSize('1.5MiB', 'quota')).toBe(1.5 * 1024 ** 2);
        expect(parseByteSize('2 GB', 'quota')).toBe(2 * 1024 ** 3);
        expect(parseByteSize('4kib', 'quota')).toBe(4 * 1024);
    });

    it('rejects malformed or unsafe byte values', () => {
        expect(() => parseByteSize('', 'quota')).toThrow('quota inválido');
        expect(() => parseByteSize('10XB', 'quota')).toThrow('quota inválido');
        expect(() => parseByteSize('0B', 'quota')).toThrow('fora do intervalo');
        expect(() => parseByteSize('9007199254740992B', 'quota')).toThrow('fora do intervalo');
    });

    it('uses the default total storage when no environment override exists', () => {
        const previousValue = process.env.STORAGE_QUOTA_BYTES;
        delete process.env.STORAGE_QUOTA_BYTES;

        expect(getStorageQuota()).toBe(defaultStorageQuota);

        if (previousValue === undefined) {
            delete process.env.STORAGE_QUOTA_BYTES;
        } else {
            process.env.STORAGE_QUOTA_BYTES = previousValue;
        }
    });

    it('converts workspace percentages using the configured total', () => {
        expect(parseWorkspaceQuota('25%', 1000)).toBe(250);
        expect(parseWorkspaceQuota('0.1%', 100)).toBe(1);
        expect(parseWorkspaceQuota('100%', 1000)).toBe(1000);
    });

    it('prevents workspace quotas from exceeding the total', () => {
        expect(() => parseWorkspaceQuota('101%', 1000)).toThrow('entre 0% e 100%');
        expect(() => parseWorkspaceQuota('2K', 1000)).toThrow('maior que o armazenamento total');
    });
});
