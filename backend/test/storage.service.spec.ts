import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from '../src/storage/storage.service';

describe('StorageService', () => {
    let storageService: StorageService;
    let storageRoot: string;
    let previousStorageRoot: string | undefined;

    beforeEach(async () => {
        previousStorageRoot = process.env.STORAGE_ROOT;
        storageRoot = await mkdtemp(join(tmpdir(), 'fast-drive-storage-test-'));
        process.env.STORAGE_ROOT = storageRoot;
        storageService = new StorageService();
    });

    afterEach(async () => {
        if (previousStorageRoot === undefined) {
            delete process.env.STORAGE_ROOT;
        } else {
            process.env.STORAGE_ROOT = previousStorageRoot;
        }
        await rm(storageRoot, { recursive: true, force: true });
    });

    it('stores a file inside the workspace path and resolves it back', async () => {
        const sourcePath = join(storageRoot, 'incoming.bin');
        await writeFile(sourcePath, 'conteúdo seguro');

        const storagePath = await storageService.saveFromPath(
            'workspace-1',
            'stored-file',
            sourcePath,
        );

        expect(storagePath).toBe('workspaces/workspace-1/files/stored-file');
        await expect(readFile(storageService.resolveStoredPath(storagePath), 'utf8')).resolves.toBe(
            'conteúdo seguro',
        );
    });

    it('rejects traversal and missing storage paths', async () => {
        expect(() => storageService.resolveStoredPath('../outside.txt')).toThrow(
            'Caminho de armazenamento inválido',
        );
        await expect(storageService.remove('../outside.txt')).rejects.toThrow(
            'Caminho de armazenamento inválido',
        );
        expect(() => storageService.resolveStoredPath('workspaces/missing')).toThrow(
            NotFoundException,
        );
    });

    it('reconciles unreferenced files without deleting referenced files', async () => {
        const filesDirectory = join(storageRoot, 'workspaces', 'workspace-1', 'files');
        await mkdir(filesDirectory, { recursive: true });
        await writeFile(join(filesDirectory, 'keep.txt'), 'keep');
        await writeFile(join(filesDirectory, 'stale.txt'), 'stale');

        const removed = await storageService.reconcile(['workspaces/workspace-1/files/keep.txt']);

        expect(removed).toBe(1);
        await expect(readFile(join(filesDirectory, 'keep.txt'), 'utf8')).resolves.toBe('keep');
        await expect(readFile(join(filesDirectory, 'stale.txt'), 'utf8')).rejects.toThrow();
        await expect(readdir(filesDirectory)).resolves.toEqual(['keep.txt']);
    });
});
