import { randomUUID } from 'node:crypto';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { type Database, DRIZZLE_DB } from '../../db/database.module';
import { files, users, workspaceMembers, workspaces } from '../../db/schema';
import { getStorageQuota, parseWorkspaceQuota } from '../../storage/storage-quota';
import { AuthService } from '../auth/auth.service';

export interface WorkspaceStorageSummary {
    quotaBytes: number;
    usedBytes: number;
    availableBytes: number;
}

export interface StorageOverview {
    totalBytes: number;
    allocatedBytes: number;
    availableBytes: number;
}

export interface WorkspaceSummary {
    id: string;
    name: string;
    role: 'OWNER' | 'MEMBER';
    quotaBytes: number;
    usedBytes: number;
    availableBytes: number;
    createdAt: Date;
    updatedAt: Date;
}

type WorkspaceRecord = Omit<WorkspaceSummary, 'usedBytes' | 'availableBytes'>;

export interface WorkspaceMemberSummary {
    id: string;
    userId: string;
    nick: string;
    role: 'OWNER' | 'MEMBER';
    createdAt: Date;
}

@Injectable()
export class WorkspacesService {
    constructor(
        @Inject(DRIZZLE_DB) private readonly db: Database,
        private readonly authService: AuthService,
    ) {}

    async listForUser(userId: string): Promise<WorkspaceSummary[]> {
        const workspaceRecords = await this.db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                role: workspaceMembers.role,
                quotaBytes: workspaces.quotaBytes,
                createdAt: workspaces.createdAt,
                updatedAt: workspaces.updatedAt,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
            .where(eq(workspaceMembers.userId, userId))
            .orderBy(workspaces.name)
            .all();
        return Promise.all(workspaceRecords.map((workspace) => this.withStorage(workspace)));
    }

    async create(userId: string, nameInput: string, quotaInput: string): Promise<WorkspaceSummary> {
        await this.requireOwner(userId);
        const name = nameInput.trim();
        if (name.length < 1 || name.length > 120) {
            throw new BadRequestException('O nome do workspace deve ter entre 1 e 120 caracteres.');
        }
        const quotaBytes = this.parseQuota(quotaInput);
        await this.ensureQuotaAvailable(quotaBytes);

        const now = new Date();
        const workspaceId = randomUUID();
        await this.db.transaction(async (tx) => {
            await tx
                .insert(workspaces)
                .values({
                    id: workspaceId,
                    name,
                    quotaBytes,
                    createdAt: now,
                    updatedAt: now,
                })
                .run();
            await tx
                .insert(workspaceMembers)
                .values({
                    id: randomUUID(),
                    workspaceId,
                    userId,
                    role: 'OWNER',
                    createdAt: now,
                    updatedAt: now,
                })
                .run();
        });

        const workspace = await this.getMembership(userId, workspaceId);
        if (!workspace) {
            throw new Error('Não foi possível criar o workspace.');
        }
        return workspace;
    }

    async updateQuota(
        ownerId: string,
        workspaceId: string,
        quotaInput: string,
    ): Promise<WorkspaceSummary> {
        await this.requireWorkspaceOwner(ownerId, workspaceId);
        const workspace = await this.db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .get();
        if (!workspace) {
            throw new NotFoundException('Workspace não encontrado.');
        }

        const quotaBytes = this.parseQuota(quotaInput);
        const usedBytes = await this.getUsedBytes(workspaceId);
        if (quotaBytes < usedBytes) {
            throw new BadRequestException('A quota não pode ser menor que o espaço já utilizado.');
        }

        const otherAllocatedBytes = await this.getAllocatedBytes(workspaceId);
        if (otherAllocatedBytes + quotaBytes > getStorageQuota()) {
            throw new ConflictException('Não há espaço total disponível para essa quota.');
        }

        await this.db
            .update(workspaces)
            .set({ quotaBytes, updatedAt: new Date() })
            .where(eq(workspaces.id, workspaceId))
            .run();
        const updatedWorkspace = await this.getMembership(ownerId, workspaceId);
        if (!updatedWorkspace) {
            throw new Error('Não foi possível atualizar a quota do workspace.');
        }
        return updatedWorkspace;
    }

    async updateName(
        ownerId: string,
        workspaceId: string,
        nameInput: string,
    ): Promise<WorkspaceSummary> {
        await this.requireWorkspaceOwner(ownerId, workspaceId);
        const workspace = await this.db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .get();
        if (!workspace) {
            throw new NotFoundException('Workspace não encontrado.');
        }

        const name = nameInput.trim();
        if (name.length < 1 || name.length > 120) {
            throw new BadRequestException('O nome do workspace deve ter entre 1 e 120 caracteres.');
        }

        await this.db
            .update(workspaces)
            .set({ name, updatedAt: new Date() })
            .where(eq(workspaces.id, workspaceId))
            .run();
        const updatedWorkspace = await this.getMembership(ownerId, workspaceId);
        if (!updatedWorkspace) {
            throw new Error('Não foi possível renomear o workspace.');
        }
        return updatedWorkspace;
    }

    async getStorageOverview(): Promise<StorageOverview> {
        const totalBytes = getStorageQuota();
        const allocatedBytes = await this.getAllocatedBytes();
        return {
            totalBytes,
            allocatedBytes,
            availableBytes: Math.max(totalBytes - allocatedBytes, 0),
        };
    }

    async getMembership(userId: string, workspaceId: string): Promise<WorkspaceSummary | null> {
        const membership = await this.db
            .select({
                id: workspaces.id,
                name: workspaces.name,
                role: workspaceMembers.role,
                quotaBytes: workspaces.quotaBytes,
                createdAt: workspaces.createdAt,
                updatedAt: workspaces.updatedAt,
            })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
            .where(
                and(
                    eq(workspaceMembers.userId, userId),
                    eq(workspaceMembers.workspaceId, workspaceId),
                ),
            )
            .get();
        return membership ? this.withStorage(membership) : null;
    }

    async requireMembership(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
        const membership = await this.getMembership(userId, workspaceId);
        if (!membership) {
            throw new ForbiddenException('Você não tem acesso a este workspace.');
        }
        return membership;
    }

    async listMembers(userId: string, workspaceId: string): Promise<WorkspaceMemberSummary[]> {
        await this.requireMembership(userId, workspaceId);
        return this.db
            .select({
                id: workspaceMembers.id,
                userId: users.id,
                nick: users.nick,
                role: workspaceMembers.role,
                createdAt: workspaceMembers.createdAt,
            })
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.workspaceId, workspaceId))
            .orderBy(users.nick)
            .all() as Promise<WorkspaceMemberSummary[]>;
    }

    async addMember(
        ownerId: string,
        workspaceId: string,
        userIdInput: string,
        nickInput: string,
    ): Promise<WorkspaceMemberSummary> {
        await this.requireWorkspaceOwner(ownerId, workspaceId);
        const userId = userIdInput.trim();
        const nick = nickInput.trim().toLowerCase();
        const user = userId
            ? await this.db.select().from(users).where(eq(users.id, userId)).get()
            : await this.db.select().from(users).where(eq(users.nick, nick)).get();
        if (!user) {
            throw new NotFoundException('Usuário não encontrado.');
        }
        if (!user.isActive) {
            throw new BadRequestException('O usuário está desativado.');
        }
        if (
            await this.db
                .select({ id: workspaceMembers.id })
                .from(workspaceMembers)
                .where(
                    and(
                        eq(workspaceMembers.workspaceId, workspaceId),
                        eq(workspaceMembers.userId, user.id),
                    ),
                )
                .get()
        ) {
            throw new ConflictException('O usuário já participa deste workspace.');
        }

        const now = new Date();
        const membershipId = randomUUID();
        await this.db
            .insert(workspaceMembers)
            .values({
                id: membershipId,
                workspaceId,
                userId: user.id,
                role: 'MEMBER',
                createdAt: now,
                updatedAt: now,
            })
            .run();
        return {
            id: membershipId,
            userId: user.id,
            nick: user.nick,
            role: 'MEMBER',
            createdAt: now,
        };
    }

    async removeMember(ownerId: string, workspaceId: string, userId: string): Promise<void> {
        await this.requireWorkspaceOwner(ownerId, workspaceId);
        const membership = await this.db
            .select()
            .from(workspaceMembers)
            .where(
                and(
                    eq(workspaceMembers.workspaceId, workspaceId),
                    eq(workspaceMembers.userId, userId),
                ),
            )
            .get();
        if (!membership) {
            throw new NotFoundException('Membro não encontrado neste workspace.');
        }
        if (membership.role === 'OWNER') {
            throw new ForbiddenException('O proprietário não pode ser removido do workspace.');
        }
        await this.db.delete(workspaceMembers).where(eq(workspaceMembers.id, membership.id)).run();
    }

    private async requireWorkspaceOwner(userId: string, workspaceId: string): Promise<void> {
        if (!(await this.authService.isOwner(userId, workspaceId))) {
            throw new ForbiddenException(
                'Apenas o proprietário do workspace pode fazer esta operação.',
            );
        }
    }

    private async requireOwner(userId: string): Promise<void> {
        if (!(await this.authService.isOwner(userId))) {
            throw new ForbiddenException('Apenas um proprietário pode criar workspaces.');
        }
    }

    private async withStorage(workspace: WorkspaceRecord): Promise<WorkspaceSummary> {
        const usedBytes = await this.getUsedBytes(workspace.id);
        return {
            ...workspace,
            usedBytes,
            availableBytes: Math.max(workspace.quotaBytes - usedBytes, 0),
        };
    }

    private async getUsedBytes(workspaceId: string): Promise<number> {
        const result = await this.db
            .select({ usedBytes: sql<number>`coalesce(sum(${files.size}), 0)` })
            .from(files)
            .where(eq(files.workspaceId, workspaceId))
            .get();
        return Number(result?.usedBytes ?? 0);
    }

    private async getAllocatedBytes(excludedWorkspaceId?: string): Promise<number> {
        const records = await this.db
            .select({ id: workspaces.id, quotaBytes: workspaces.quotaBytes })
            .from(workspaces)
            .all();
        return records
            .filter((workspace) => workspace.id !== excludedWorkspaceId)
            .reduce((total, workspace) => total + workspace.quotaBytes, 0);
    }

    private async ensureQuotaAvailable(quotaBytes: number): Promise<void> {
        const overview = await this.getStorageOverview();
        if (quotaBytes > overview.availableBytes) {
            throw new ConflictException(
                `Não há espaço total disponível. Restam ${overview.availableBytes} bytes para alocar.`,
            );
        }
    }

    private parseQuota(value: string): number {
        try {
            return parseWorkspaceQuota(value);
        } catch (error: unknown) {
            throw new BadRequestException(
                error instanceof Error ? error.message : 'Quota inválida.',
            );
        }
    }
}
