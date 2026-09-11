import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class StorageService {
    private readonly root = resolve(process.env.STORAGE_ROOT?.trim() || './data/storage');

    constructor() {
        if (!existsSync(this.root)) {
            void mkdir(this.root, { recursive: true });
        }
    }

    async saveFromPath(
        workspaceId: string,
        storedName: string,
        sourcePath: string,
    ): Promise<string> {
        const workspaceDirectory = this.resolveInsideRoot('workspaces', workspaceId, 'files');
        await mkdir(workspaceDirectory, { recursive: true });
        const absolutePath = this.resolveInsideRoot('workspaces', workspaceId, 'files', storedName);
        await pipeline(
            createReadStream(sourcePath),
            createWriteStream(absolutePath, { flags: 'wx' }),
        );
        return this.toStoragePath(absolutePath);
    }

    resolveStoredPath(storagePath: string): string {
        const absolutePath = this.resolveInsideRoot(...storagePath.split('/'));
        if (!existsSync(absolutePath)) {
            throw new NotFoundException('Conteúdo do arquivo não encontrado no armazenamento.');
        }
        return absolutePath;
    }

    async remove(storagePath: string): Promise<void> {
        const absolutePath = this.resolveInsideRoot(...storagePath.split('/'));
        await rm(absolutePath, { force: true });
    }

    async reconcile(referencedPaths: Iterable<string>): Promise<number> {
        await mkdir(this.root, { recursive: true });
        const referenced = new Set(referencedPaths);
        const storedFiles = await this.listFiles(this.root);
        let removedCount = 0;
        for (const absolutePath of storedFiles) {
            const storagePath = this.toStoragePath(absolutePath);
            if (referenced.has(storagePath)) {
                continue;
            }
            await rm(absolutePath, { force: true });
            removedCount += 1;
        }
        return removedCount;
    }

    private toStoragePath(absolutePath: string): string {
        return relative(this.root, absolutePath).split(String.fromCharCode(92)).join('/');
    }

    private async listFiles(directory: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
            const entryPath = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                files.push(...(await this.listFiles(entryPath)));
            } else if (entry.isFile()) {
                files.push(entryPath);
            }
        }
        return files;
    }

    private resolveInsideRoot(...parts: string[]): string {
        const candidate = resolve(this.root, ...parts);
        const relativePath = relative(this.root, candidate);
        if (
            isAbsolute(relativePath) ||
            relativePath.startsWith(`..${sep}`) ||
            relativePath === '..'
        ) {
            throw new Error('Caminho de armazenamento inválido.');
        }
        return candidate;
    }
}
