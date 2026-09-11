import { createWorkspaceInputSchema } from '@fast-drive/shared-types';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseWithZod } from '../src/common/zod-validation';
import { getSafePublicContentType } from '../src/routes/shares/public-content';

describe('backend validation boundaries', () => {
    it('returns the parsed value for valid zod input', () => {
        expect(
            parseWithZod(createWorkspaceInputSchema, {
                name: '  Documents  ',
                quota: '50%',
            }),
        ).toEqual({ name: 'Documents', quota: '50%' });
    });

    it('converts zod issues into a structured bad request', () => {
        try {
            parseWithZod(createWorkspaceInputSchema, { name: '', quota: 10 });
            throw new Error('expected validation to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(BadRequestException);
            expect((error as BadRequestException).getResponse()).toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        }
    });

    it('allows safe inline media and forces unknown media to download', () => {
        expect(getSafePublicContentType('IMAGE/PNG; charset=utf-8')).toEqual({
            inline: true,
            mimeType: 'image/png',
        });
        expect(getSafePublicContentType('text/html')).toEqual({
            inline: false,
            mimeType: 'application/octet-stream',
        });
        expect(getSafePublicContentType('')).toEqual({
            inline: false,
            mimeType: 'application/octet-stream',
        });
    });
});
