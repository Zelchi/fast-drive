import { successResponseSchema } from '@fast-drive/shared-types';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { parseRequest, validateResponse } from '../src/app/core/api-validation';

describe('api validation', () => {
    it('parses request data with the shared schema', () => {
        expect(parseRequest(successResponseSchema, { success: true })).toEqual({ success: true });
    });

    it('validates response data in an observable pipeline', async () => {
        await expect(
            firstValueFrom(of({ success: true }).pipe(validateResponse(successResponseSchema))),
        ).resolves.toEqual({ success: true });
    });
});
