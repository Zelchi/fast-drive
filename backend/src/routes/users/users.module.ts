import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';

@Module({
    imports: [AuthModule, AuditModule],
    controllers: [UsersController],
})
export class UsersModule {}
