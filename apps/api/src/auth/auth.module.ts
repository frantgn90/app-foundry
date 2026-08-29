import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GithubStrategy } from './github.strategy.js';
import { RateLimitGuard } from './rate-limit.guard.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

@Module({
  // Sin sesión de Express: la nuestra es una cookie opaca propia y el `state`
  // del flujo OAuth vive en Redis.
  imports: [PassportModule.register({ session: false })],
  controllers: [AuthController],
  providers: [AuthService, SessionService, GithubStrategy, SessionGuard, RateLimitGuard],
  exports: [SessionService, AuthService],
})
export class AuthModule {}
