import { randomUUID } from 'node:crypto';
import { mkdirSync, unlink } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    type CallHandler,
    type ExecutionContext,
    Injectable,
    type NestInterceptor,
    type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { finalize, type Observable } from 'rxjs';
import { getMaxFileSize } from './file-size';

interface UploadRequest {
    file?: Express.Multer.File;
}

const uploadDirectory = resolve(
    process.env.UPLOAD_TEMP_ROOT?.trim() || join(tmpdir(), 'fast-drive-uploads'),
);
mkdirSync(uploadDirectory, { recursive: true });

const multerInterceptor = FileInterceptor('file', {
    storage: diskStorage({
        destination: uploadDirectory,
        filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`),
    }),
    limits: {
        fileSize: getMaxFileSize(),
    },
});

@Injectable()
export class UploadInterceptor implements NestInterceptor {
    private readonly delegate = new (multerInterceptor as Type<NestInterceptor>)();

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const request = context.switchToHttp().getRequest<UploadRequest>();
        try {
            const delegated = await this.delegate.intercept(context, next);
            return delegated.pipe(finalize(() => this.cleanup(request)));
        } catch (error) {
            this.cleanup(request);
            throw error;
        }
    }

    private cleanup(request: UploadRequest): void {
        const path = request.file?.path;
        if (path) {
            unlink(path, () => undefined);
        }
    }
}
