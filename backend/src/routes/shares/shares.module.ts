import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { StorageService } from '../../storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
    imports: [AuthModule, WorkspacesModule, AuditModule],
    controllers: [SharesController],
    providers: [SharesService, StorageService],
})
export class SharesModule {}
