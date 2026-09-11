import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { SessionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

@Module({
    controllers: [AuthController],
    providers: [AuthService, SessionGuard, LoginRateLimitGuard],
    exports: [AuthService, SessionGuard],
})
export class AuthModule {}
