import { createUserInputSchema, updateUserInputSchema } from '@fast-drive/auth';
import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Param,
    Patch,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { parseWithZod } from '../../common/zod-validation';
import { SessionGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';

@Controller('users')
@UseGuards(SessionGuard)
export class UsersController {
    constructor(
        private readonly authService: AuthService,
        private readonly auditService: AuditService,
    ) {}

    @Get()
    async list(@Req() request: AuthenticatedRequest) {
        await this.requireOwner(request);
        return this.authService.listUsers();
    }

    @Post()
    async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
        await this.requireOwner(request);
        const input = parseWithZod(createUserInputSchema, body);
        const result = await this.authService.createUser(input.nick);
        await this.auditService.record({
            userId: request.user?.id,
            event: 'user.created',
            targetType: 'user',
            targetId: result.user.id,
            metadata: { nick: result.user.nick },
        });
        return {
            user: this.authService.toPublicUser(result.user),
            serial: result.serial,
        };
    }

    @Patch(':id')
    async update(
        @Req() request: AuthenticatedRequest,
        @Param('id') userId: string,
        @Body() body: unknown,
    ) {
        await this.requireOwner(request);
        const { isActive } = parseWithZod(updateUserInputSchema, body);
        if (isActive === undefined) {
            return {
                user: this.authService.toPublicUser(await this.authService.requireUser(userId)),
            };
        }
        const user = await this.authService.setUserActive(userId, isActive);
        await this.auditService.record({
            userId: request.user?.id,
            event: isActive ? 'user.activated' : 'user.deactivated',
            targetType: 'user',
            targetId: userId,
            metadata: { nick: user.nick },
        });
        return { user };
    }

    @Post(':id/rotate-serial')
    async rotateSerial(@Req() request: AuthenticatedRequest, @Param('id') userId: string) {
        await this.requireOwner(request);
        const result = await this.authService.rotateSerial(userId);
        await this.auditService.record({
            userId: request.user?.id,
            event: 'user.serial_rotated',
            targetType: 'user',
            targetId: userId,
            metadata: { nick: result.user.nick },
        });
        return result;
    }

    @Post(':id/revoke-serial')
    async revokeSerial(@Req() request: AuthenticatedRequest, @Param('id') userId: string) {
        await this.requireOwner(request);
        const user = await this.authService.revokeSerial(userId);
        await this.auditService.record({
            userId: request.user?.id,
            event: 'user.serial_revoked',
            targetType: 'user',
            targetId: userId,
            metadata: { nick: user.nick },
        });
        return { user };
    }

    private async requireOwner(request: AuthenticatedRequest): Promise<void> {
        if (!request.user || !(await this.authService.isOwner(request.user.id))) {
            throw new ForbiddenException('Apenas o proprietário pode administrar usuários.');
        }
    }
}
