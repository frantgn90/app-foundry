import { type DynamicModule, Module, type ModuleMetadata, type Provider } from '@nestjs/common';

import { NotificationEmitter } from './emitter.service.js';
import { NOTIFICATION_METRICS } from './ports.js';
import { NotificationsStream } from './stream.service.js';

/**
 * El emisor de avisos, para quien lo necesite.
 *
 * Dinámico por lo mismo que el runtime de IA: la única pieza que le falta —a
 * dónde van las métricas— la decide quien lo monta, y un módulo de Nest solo
 * resuelve lo que declara o lo que importa.
 */
@Module({})
export class NotificationEmitterModule {
  static forRoot(opciones: {
    imports?: ModuleMetadata['imports'];
    /** `NOTIFICATION_METRICS`. */
    providers: Provider[];
  }): DynamicModule {
    return {
      module: NotificationEmitterModule,
      imports: opciones.imports ?? [],
      providers: [...opciones.providers, NotificationsStream, NotificationEmitter],
      exports: [NotificationsStream, NotificationEmitter, NOTIFICATION_METRICS],
    };
  }
}
