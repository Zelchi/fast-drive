import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, DRIZZLE_DB } from '../db/database.module';
import { auditLogs } from '../db/schema';

export type AuditMetadata = Readonly<Record<string, boolean | number | string | null>>;

export interface AuditEntry {
    userId?: string;
    event: string;
    targetType: string;
    targetId?: string;
    metadata?: AuditMetadata;
}

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

    async record(entry: AuditEntry): Promise<void> {
        try {
            await this.db
                .insert(auditLogs)
                .values({
                    id: randomUUID(),
                    userId: entry.userId ?? null,
                    event: entry.event,
                    targetType: entry.targetType,
                    targetId: entry.targetId ?? null,
                    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
                    createdAt: new Date(),
                })
                .run();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Não foi possível registrar a auditoria: ${message}`);
        }
    }
}
