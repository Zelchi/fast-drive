import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localPrivateKeyPath = path.join(applicationDirectory, '.tauri', 'fast-drive.key');
const environment = { ...process.env };

if (process.platform === 'linux') {
    environment.NO_STRIP ??= '1';
}

if (!environment.TAURI_SIGNING_PRIVATE_KEY) {
    if (fs.existsSync(localPrivateKeyPath)) {
        environment.TAURI_SIGNING_PRIVATE_KEY = localPrivateKeyPath;
        environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
    }
}

const tauri = spawn('tauri', ['build', ...process.argv.slice(2)], {
    cwd: applicationDirectory,
    env: environment,
    shell: process.platform === 'win32',
    stdio: 'inherit',
});

tauri.on('error', (error) => {
    console.error(`Não foi possível iniciar o Tauri: ${error.message}`);
    process.exitCode = 1;
});

tauri.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
    }

    process.exitCode = code ?? 1;
});
