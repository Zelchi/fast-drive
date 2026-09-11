import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../db/database.module';
import { AuthModule } from '../routes/auth/auth.module';
import { FilesModule } from '../routes/files/files.module';
import { SharesModule } from '../routes/shares/shares.module';
import { UsersModule } from '../routes/users/users.module';
import { WorkspacesModule } from '../routes/workspaces/workspaces.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BootstrapService } from './bootstrap.service';

@Module({
    imports: [
        DatabaseModule,
        AuditModule,
        AuthModule,
        UsersModule,
        WorkspacesModule,
        FilesModule,
        SharesModule,
    ],
    controllers: [AppController],
    providers: [AppService, BootstrapService],
})
export class AppModule {}
