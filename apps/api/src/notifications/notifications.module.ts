import { Global, Module } from '@nestjs/common';

import { NotificationsChannel } from './notifications.channel.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsPurge } from './notifications.purge.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsStream } from './notifications.stream.js';

/**
 * Global porque casi cualquier acción del sistema puede tener que avisar a
 * alguien, igual que casi cualquiera deja rastro en la auditoría.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsStream, NotificationsChannel, NotificationsPurge],
  exports: [NotificationsService, NotificationsStream, NotificationsPurge],
})
export class NotificationsModule {}
