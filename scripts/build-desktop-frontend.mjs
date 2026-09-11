import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const frontendIndex = path.resolve('frontend/dist/frontend/browser/index.html');

if (process.env.FAST_DRIVE_SKIP_FRONTEND_BUILD === '1') {
    if (!fs.existsSync(frontendIndex)) {
        console.error(`Frontend pré-compilado não encontrado em ${frontendIndex}.`);
        process.exit(1);
    }

    console.log('Usando o frontend pré-compilado do artifact da release.');
    process.exit(0);
}

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

function runYarn(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(yarnCommand, args, {
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`yarn foi encerrado pelo sinal ${signal}.`));
                return;
            }

            if (code !== 0) {
                reject(new Error(`yarn terminou com código ${code ?? 1}.`));
                return;
            }

            resolve();
        });
    });
}

try {
    await runYarn(['build:packages']);
    await runYarn(['--cwd', 'frontend', 'build']);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
