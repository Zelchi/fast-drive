import { createReadStream } from 'node:fs';
import { updateFileShareInputSchema } from '@fast-drive/file-models';
import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Req,
    Res,
    StreamableFile,
    UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditService } from '../../audit/audit.service';
import { parseWithZod } from '../../common/zod-validation';
import { SessionGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { getSafePublicContentType } from './public-content';
import { type FileShareSummary, SharesService } from './shares.service';

interface ByteRange {
    start: number;
    end: number;
}

function parseByteRange(value: string | undefined, size: number): ByteRange | null {
    if (!value || size <= 0 || !value.startsWith('bytes=')) {
        return null;
    }

    const range = value.slice('bytes='.length).split(',')[0]?.trim();
    if (!range) {
        return null;
    }

    const separator = range.indexOf('-');
    if (separator < 0) {
        return null;
    }

    const startText = range.slice(0, separator).trim();
    const endText = range.slice(separator + 1).trim();
    if (!startText && !endText) {
        return null;
    }

    if (!startText) {
        const suffixLength = Number(endText);
        if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
            return null;
        }
        return { start: Math.max(0, size - suffixLength), end: size - 1 };
    }

    const start = Number(startText);
    if (!Number.isInteger(start) || start < 0 || start >= size) {
        return null;
    }

    const requestedEnd = endText ? Number(endText) : size - 1;
    if (!Number.isInteger(requestedEnd) || requestedEnd < start) {
        return null;
    }

    return { start, end: Math.min(requestedEnd, size - 1) };
}

@Controller()
export class SharesController {
    constructor(
        private readonly sharesService: SharesService,
        private readonly auditService: AuditService,
    ) {}

    @Get('files/:fileId/share')
    @UseGuards(SessionGuard)
    async getShare(@Req() request: AuthenticatedRequest, @Param('fileId') fileId: string) {
        const share = await this.sharesService.getForUser(request.user?.id ?? '', fileId);
        return { share: this.toResponse(share) };
    }

    @Patch('files/:fileId/share')
    @UseGuards(SessionGuard)
    async updateShare(
        @Req() request: AuthenticatedRequest,
        @Param('fileId') fileId: string,
        @Body() body: unknown,
    ) {
        const input = parseWithZod(updateFileShareInputSchema, body);
        const share = await this.sharesService.updateForUser(
            request.user?.id ?? '',
            fileId,
            input.isPublic,
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: share.isPublic ? 'file.share_enabled' : 'file.share_disabled',
            targetType: 'file',
            targetId: fileId,
            metadata: { isPublic: share.isPublic },
        });
        return { share: this.toResponse(share) };
    }

    @Get('shares/:token/metadata')
    async metadata(@Param('token') token: string) {
        return this.sharesService.getPublicMetadata(token);
    }

    @Get('shares/:token/content')
    async preview(
        @Param('token') token: string,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<StreamableFile> {
        const file = await this.sharesService.getPublicFile(token);
        const range = parseByteRange(
            typeof request.headers.range === 'string' ? request.headers.range : undefined,
            file.size,
        );
        const contentType = getSafePublicContentType(file.mimeType);
        response.setHeader('Content-Type', contentType.mimeType);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader(
            'Content-Disposition',
            `${contentType.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        );

        if (range) {
            response.status(206);
            response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
            response.setHeader('Content-Length', String(range.end - range.start + 1));
            return new StreamableFile(
                createReadStream(file.path, { start: range.start, end: range.end }),
            );
        }

        response.setHeader('Content-Length', String(file.size));
        return new StreamableFile(createReadStream(file.path));
    }

    @Get('shares/:token')
    async downloadPublic(
        @Param('token') token: string,
        @Res({ passthrough: true }) response: Response,
    ): Promise<StreamableFile> {
        const file = await this.sharesService.getPublicFile(token);
        const contentType = getSafePublicContentType(file.mimeType);
        response.setHeader('Content-Type', contentType.mimeType);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Length', String(file.size));
        response.setHeader(
            'Content-Disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        );
        return new StreamableFile(createReadStream(file.path));
    }

    private toResponse(share: FileShareSummary) {
        const configuredBaseUrl =
            process.env.PUBLIC_SHARE_BASE_URL?.trim() || 'http://localhost:7000';
        const baseUrl = configuredBaseUrl.replace(/\/+$/, '');
        return {
            ...share,
            url: `${baseUrl}/share/${encodeURIComponent(share.token)}`,
        };
    }
}
