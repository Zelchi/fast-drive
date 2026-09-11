import { BadRequestException } from '@nestjs/common';
import type { ZodType } from 'zod';

export function parseWithZod<T>(schema: ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        const message = result.error.issues
            .map((issue) => {
                const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
                return `${path}${issue.message}`;
            })
            .join(' ');
        throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message,
            issues: result.error.issues,
        });
    }
    return result.data;
}
