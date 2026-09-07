import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AgentsModule } from './agents/agents.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { AiModule } from './ai/ai.module.js';
import { AppsModule } from './apps/apps.module.js';
import { AuditModule } from './audit/audit.service.js';
import { AdminModule } from './admin/admin.module.js';
import { MetricsModule } from './observability/metrics.service.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SearchModule } from './search/search.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { TransactionInterceptor } from './database/transaction.interceptor.js';
import { HealthModule } from './health/health.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [
    InfrastructureModule,
    AuditModule,
    MetricsModule,
    NotificationsModule,
    SearchModule,
    AdminModule,
    AuthModule,
    WorkspacesModule,
    AppsModule,
    AiModule,
    AgentsModule,
    ReviewsModule,
    DocumentsModule,
    CommentsModule,
    HealthModule,
  ],
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
