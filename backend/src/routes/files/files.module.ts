import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { StorageService } from '../../storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
    imports: [AuthModule, WorkspacesModule, AuditModule],
    controllers: [FilesController],
    providers: [StorageService, FilesService],
    exports: [FilesService],
})
export class FilesModule {}
