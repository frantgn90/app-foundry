import { Global, Module } from '@nestjs/common';

import { NotificationsService } from './notifications.service.js';

/**
 * Global porque casi cualquier acción del sistema puede tener que avisar a
 * alguien, igual que casi cualquiera deja rastro en la auditoría.
 */
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
