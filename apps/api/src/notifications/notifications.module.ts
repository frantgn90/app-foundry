import { Global, Module } from '@nestjs/common';

import { NOTIFICATION_METRICS, NotificationEmitterModule } from '@app-foundry/notifications';

import { MetricsService } from '../observability/metrics.service.js';
import { NotificationsChannel } from './notifications.channel.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsPurge } from './notifications.purge.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Global porque casi cualquier acción del sistema puede tener que avisar a
 * alguien, igual que casi cualquiera deja rastro en la auditoría.
 *
 * Lo de escribir avisos viene del paquete compartido —lo hacen dos procesos— y
 * aquí se le enchufan las métricas de la API. Lo que se queda: las rutas de
 * leer y marcar, el canal en tiempo real y la purga.
 */
@Global()
@Module({
  imports: [
    NotificationEmitterModule.forRoot({
      providers: [{ provide: NOTIFICATION_METRICS, useExisting: MetricsService }],
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsChannel, NotificationsPurge],
  exports: [NotificationsService, NotificationsPurge, NotificationEmitterModule],
})
export class NotificationsModule {}
