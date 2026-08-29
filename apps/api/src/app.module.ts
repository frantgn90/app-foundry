import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuditModule } from './audit/audit.service.js';
import { AuthModule } from './auth/auth.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { TransactionInterceptor } from './database/transaction.interceptor.js';
import { HealthModule } from './health/health.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [InfrastructureModule, AuditModule, AuthModule, WorkspacesModule, HealthModule],
  providers: [
    /*
     * El guard va primero y es global: así un endpoint nuevo nace protegido y
     * hay que marcarlo con @Publico() para abrirlo, en vez de al revés (RF-109).
     */
    { provide: APP_GUARD, useClass: SessionGuard },
    /*
     * El interceptor abre la transacción y fija la identidad que el guard acaba
     * de resolver. El orden importa: sin usuario validado no habría identidad
     * que fijar.
     */
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
  ],
})
export class AppModule {}
