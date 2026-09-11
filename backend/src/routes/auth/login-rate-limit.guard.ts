import {
    type CanActivate,
    type ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

interface AttemptRecord {
    count: number;
    resetAt: number;
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
    private readonly attempts = new Map<string, AttemptRecord>();
    private readonly limit = this.readPositiveInteger('LOGIN_RATE_LIMIT_MAX', 10);
    private readonly windowMs =
        this.readPositiveInteger('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 60) * 1_000;

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const now = Date.now();
        this.removeExpired(now);

        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const nick =
            'nick' in body && typeof body.nick === 'string'
                ? body.nick.trim().toLowerCase()
                : '<sem-nick>';
        const address = request.ip || request.socket.remoteAddress || 'unknown';
        const key = `${address}:${nick}`;
        const current = this.attempts.get(key);
        const record =
            current && current.resetAt > now ? current : { count: 0, resetAt: now + this.windowMs };

        if (record.count >= this.limit) {
            throw new HttpException(
                'Muitas tentativas de login. Aguarde antes de tentar novamente.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        record.count += 1;
        this.attempts.set(key, record);
        request.res?.once('finish', () => {
            if ((request.res?.statusCode ?? 500) < 400) {
                record.count = Math.max(0, record.count - 1);
            }
        });
        this.limitMapSize();
        return true;
    }

    private removeExpired(now: number): void {
        for (const [key, record] of this.attempts) {
            if (record.resetAt <= now) {
                this.attempts.delete(key);
            }
        }
    }

    private limitMapSize(): void {
        while (this.attempts.size > 10_000) {
            const firstKey = this.attempts.keys().next().value;
            if (typeof firstKey !== 'string') {
                return;
            }
            this.attempts.delete(firstKey);
        }
    }

    private readPositiveInteger(name: string, fallback: number): number {
        const value = Number(process.env[name]);
        return Number.isInteger(value) && value > 0 ? value : fallback;
    }
}
