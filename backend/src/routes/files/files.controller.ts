import { createReadStream } from 'node:fs';
import {
    createFolderInputSchema,
    updateFileInputSchema,
    updateFolderInputSchema,
} from '@fast-drive/file-models';
import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseFilePipeBuilder,
    Patch,
    Post,
    Query,
    Req,
    Res,
    StreamableFile,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditService } from '../../audit/audit.service';
import { parseWithZod } from '../../common/zod-validation';
import { SessionGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { getMaxFileSize } from './file-size';
import { FilesService } from './files.service';
import { UploadInterceptor } from './upload.interceptor';

@Controller()
@UseGuards(SessionGuard)
export class FilesController {
    constructor(
        private readonly filesService: FilesService,
        private readonly auditService: AuditService,
    ) {}

    @Get('workspaces/:workspaceId/files')
    async list(
        @Req() request: AuthenticatedRequest,
        @Param('workspaceId') workspaceId: string,
        @Query('folderId') folderId?: string,
    ) {
        return this.filesService.list(request.user?.id ?? '', workspaceId, folderId);
    }

    @Get('workspaces/:workspaceId/folders')
    async listFolders(
        @Req() request: AuthenticatedRequest,
        @Param('workspaceId') workspaceId: string,
    ) {
        return {
            folders: await this.filesService.listFolders(request.user?.id ?? '', workspaceId),
        };
    }

    @Post('workspaces/:workspaceId/folders')
    async createFolder(
        @Req() request: AuthenticatedRequest,
        @Param('workspaceId') workspaceId: string,
        @Body() body: unknown,
    ) {
        const input = parseWithZod(createFolderInputSchema, body);
        const folder = await this.filesService.createFolder(
            request.user?.id ?? '',
            workspaceId,
            input.name,
            input.parentId,
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: 'folder.created',
            targetType: 'folder',
            targetId: folder.id,
            metadata: { workspaceId, parentId: folder.parentId, name: folder.name },
        });
        return {
            folder,
        };
    }

    @Patch('folders/:id')
    async updateFolder(
        @Req() request: AuthenticatedRequest,
        @Param('id') folderId: string,
        @Body() body: unknown,
    ) {
        const input = parseWithZod(updateFolderInputSchema, body);
        const folder = await this.filesService.updateFolder(
            request.user?.id ?? '',
            folderId,
            input.name,
            input.parentId,
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: 'folder.updated',
            targetType: 'folder',
            targetId: folderId,
            metadata: { name: folder.name, parentId: folder.parentId },
        });
        return {
            folder,
        };
    }

    @Delete('folders/:id')
    async deleteFolder(
        @Req() request: AuthenticatedRequest,
        @Param('id') folderId: string,
        @Query('recursive') recursive?: string,
    ) {
        const deleteContents = recursive === 'true';
        await this.filesService.deleteFolder(request.user?.id ?? '', folderId, deleteContents);
        await this.auditService.record({
            userId: request.user?.id,
            event: 'folder.deleted',
            targetType: 'folder',
            targetId: folderId,
            metadata: { recursive: deleteContents },
        });
        return { success: true };
    }

    @Post('workspaces/:workspaceId/files')
    @UseInterceptors(UploadInterceptor)
    async upload(
        @Req() request: AuthenticatedRequest,
        @Param('workspaceId') workspaceId: string,
        @Query('folderId') folderId: string | undefined,
        @UploadedFile(
            new ParseFilePipeBuilder()
                .addMaxSizeValidator({
                    maxSize: getMaxFileSize(),
                })
                .build({ fileIsRequired: true }),
        )
        uploadedFile: Express.Multer.File,
    ) {
        const file = await this.filesService.upload(
            request.user?.id ?? '',
            workspaceId,
            folderId,
            uploadedFile,
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: 'file.uploaded',
            targetType: 'file',
            targetId: file.id,
            metadata: {
                workspaceId,
                folderId: file.folderId,
                name: file.originalName,
                size: file.size,
            },
        });
        return {
            file,
        };
    }

    @Get('files/:id/download')
    async download(
        @Req() request: AuthenticatedRequest,
        @Param('id') fileId: string,
        @Res({ passthrough: true }) response: Response,
    ): Promise<StreamableFile> {
        const file = await this.filesService.getDownload(request.user?.id ?? '', fileId);
        response.setHeader('Content-Type', file.mimeType);
        response.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        );
        return new StreamableFile(createReadStream(file.path));
    }

    @Patch('files/:id')
    async updateFile(
        @Req() request: AuthenticatedRequest,
        @Param('id') fileId: string,
        @Body() body: unknown,
    ) {
        const input = parseWithZod(updateFileInputSchema, body);
        const file = await this.filesService.updateFile(
            request.user?.id ?? '',
            fileId,
            input.name,
            input.folderId,
            input.extension,
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: 'file.updated',
            targetType: 'file',
            targetId: fileId,
            metadata: { name: file.originalName, folderId: file.folderId },
        });
        return {
            file,
        };
    }

    @Delete('files/:id')
    async deleteFile(@Req() request: AuthenticatedRequest, @Param('id') fileId: string) {
        await this.filesService.deleteFile(request.user?.id ?? '', fileId);
        await this.auditService.record({
            userId: request.user?.id,
            event: 'file.deleted',
            targetType: 'file',
            targetId: fileId,
        });
        return { success: true };
    }
}
