import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import type { NextFunction, Request, Response } from 'express';
import * as express from 'express';
import { AppModule } from './app/app.module';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(__dirname, '../../.env') });

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { bodyParser: false });
    app.use(express.json({ limit: '512kb' }));
    app.use(express.urlencoded({ extended: true, limit: '512kb' }));
    const globalPrefix = 'api';
    app.setGlobalPrefix(globalPrefix);
    const corsOrigin = process.env.CORS_ORIGIN?.trim();
    if (corsOrigin) {
        app.enableCors({ origin: corsOrigin, credentials: true });
    }
    const webRoot = resolve(
        process.env.WEB_DIST_ROOT?.trim() ||
            join(__dirname, '../../frontend/dist/frontend/browser'),
    );
    const indexPath = join(webRoot, 'index.html');
    if (existsSync(indexPath)) {
        app.use(express.static(webRoot));
        app.use((request: Request, response: Response, next: NextFunction) => {
            if (request.method === 'GET' && !request.path.startsWith(`/${globalPrefix}`)) {
                response.sendFile(indexPath);
                return;
            }
            next();
        });
    }
    const port = process.env.API_PORT || process.env.PORT || 7000;
    await app.listen(port);
    Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
