import {
    addWorkspaceMemberInputSchema,
    createWorkspaceInputSchema,
    updateWorkspaceInputSchema,
} from '@fast-drive/shared-types';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { parseWithZod } from '../../common/zod-validation';
import { SessionGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(SessionGuard)
export class WorkspacesController {
    constructor(
        private readonly workspacesService: WorkspacesService,
        private readonly auditService: AuditService,
    ) {}

    @Get()
    async list(@Req() request: AuthenticatedRequest) {
        const [workspaces, storage] = await Promise.all([
            this.workspacesService.listForUser(request.user?.id ?? ''),
            this.workspacesService.getStorageOverview(),
        ]);
        return { workspaces, storage };
    }

    @Post()
    async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
        const input = parseWithZod(createWorkspaceInputSchema, body);
        const workspace = await this.workspacesService.create(
            request.user?.id ?? '',
            input.name,
            input.quota,
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: 'workspace.created',
            targetType: 'workspace',
            targetId: workspace.id,
            metadata: { name: workspace.name, quotaBytes: workspace.quotaBytes },
        });
        return {
            workspace,
            storage: await this.workspacesService.getStorageOverview(),
        };
    }

    @Patch(':id')
    async update(
        @Req() request: AuthenticatedRequest,
        @Param('id') workspaceId: string,
        @Body() body: unknown,
    ) {
        const { name, quota } = parseWithZod(updateWorkspaceInputSchema, body);

        const workspace =
            name !== undefined
                ? await this.workspacesService.updateName(request.user?.id ?? '', workspaceId, name)
                : await this.workspacesService.updateQuota(
                      request.user?.id ?? '',
                      workspaceId,
                      quota ?? '',
                  );
        await this.auditService.record({
            userId: request.user?.id,
            event: name !== undefined ? 'workspace.renamed' : 'workspace.quota_updated',
            targetType: 'workspace',
            targetId: workspace.id,
            metadata:
                name !== undefined
                    ? { name: workspace.name }
                    : { quotaBytes: workspace.quotaBytes },
        });
        return {
            workspace,
            storage: await this.workspacesService.getStorageOverview(),
        };
    }

    @Get(':id/members')
    async listMembers(@Req() request: AuthenticatedRequest, @Param('id') workspaceId: string) {
        return {
            members: await this.workspacesService.listMembers(request.user?.id ?? '', workspaceId),
        };
    }

    @Post(':id/members')
    async addMember(
        @Req() request: AuthenticatedRequest,
        @Param('id') workspaceId: string,
        @Body() body: unknown,
    ) {
        const input = parseWithZod(addWorkspaceMemberInputSchema, body);
        const member = await this.workspacesService.addMember(
            request.user?.id ?? '',
            workspaceId,
            input.userId ?? '',
            input.nick ?? '',
        );
        await this.auditService.record({
            userId: request.user?.id,
            event: 'workspace.member_added',
            targetType: 'workspace',
            targetId: workspaceId,
            metadata: { memberUserId: member.userId, memberNick: member.nick },
        });
        return { member };
    }

    @Delete(':id/members/:userId')
    async removeMember(
        @Req() request: AuthenticatedRequest,
        @Param('id') workspaceId: string,
        @Param('userId') userId: string,
    ) {
        await this.workspacesService.removeMember(request.user?.id ?? '', workspaceId, userId);
        await this.auditService.record({
            userId: request.user?.id,
            event: 'workspace.member_removed',
            targetType: 'workspace',
            targetId: workspaceId,
            metadata: { memberUserId: userId },
        });
        return { success: true };
    }
}
