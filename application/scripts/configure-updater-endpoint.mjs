import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationDirectory = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(applicationDirectory, '../src-tauri/tauri.conf.json');
const repository = process.env.GITHUB_REPOSITORY;

if (!repository) {
    console.warn(
        'GITHUB_REPOSITORY não definido; mantendo o endpoint do updater configurado localmente.',
    );
    process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.plugins.updater.endpoints = [
    `https://github.com/${repository}/releases/latest/download/latest.json`,
];

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Endpoint do updater configurado para ${repository}.`);
