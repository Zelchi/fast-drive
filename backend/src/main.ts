import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, RequestMethod } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
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
    app.setGlobalPrefix(globalPrefix, {
        exclude: [{ path: 'share/:token/view', method: RequestMethod.GET }],
    });
    const configuredCorsOrigins = (process.env.CORS_ORIGIN ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const allowedCorsOrigins = new Set([
        ...configuredCorsOrigins,
        'http://localhost:7123',
        'http://127.0.0.1:7123',
        'http://tauri.localhost',
        'https://tauri.localhost',
        'tauri://localhost',
    ]);
    if (allowedCorsOrigins.size > 0) {
        const corsOrigin: CustomOrigin = (origin, callback) => {
            if (!origin || allowedCorsOrigins.has(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        };
        app.enableCors({
            origin: corsOrigin,
            credentials: true,
        });
    }
    const webRoot = resolve(
        process.env.WEB_DIST_ROOT?.trim() ||
            join(__dirname, '../../frontend/dist/frontend/browser'),
    );
    const indexPath = join(webRoot, 'index.html');
    if (existsSync(indexPath)) {
        app.use(express.static(webRoot));
        app.use((request: Request, response: Response, next: NextFunction) => {
            const isPublicMediaView = /^\/share\/[^/]+\/view\/?$/.test(request.path);
            if (
                request.method === 'GET' &&
                !request.path.startsWith(`/${globalPrefix}`) &&
                !isPublicMediaView
            ) {
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
