import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuthService } from '../routes/auth/auth.service';
import { FilesService } from '../routes/files/files.service';

@Injectable()
export class BootstrapService implements OnModuleInit {
    private readonly logger = new Logger(BootstrapService.name);

    constructor(
        private readonly authService: AuthService,
        private readonly filesService: FilesService,
    ) {}

    async onModuleInit(): Promise<void> {
        await this.authService.ensureInitialOwner();
        const removedOrphans = await this.filesService.reconcileStorage();
        if (removedOrphans > 0) {
            this.logger.log(`Arquivos órfãos removidos do armazenamento: ${removedOrphans}`);
        }
        if (process.env.OWNER_NICK && process.env.OWNER_SERIAL) {
            this.logger.log(`Usuário proprietário disponível: ${process.env.OWNER_NICK}`);
        }
    }
}
