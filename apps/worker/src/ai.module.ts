import { Global, Logger, Module } from '@nestjs/common';
import { Redis } from 'ioredis';

import {
  AnthropicProvider,
  CredentialCipher,
  createProviderRegistry,
  FakeProvider,
  GroqProvider,
  type ProviderRegistry,
  parseKeyRing,
} from '@app-foundry/ai';
import { AiProvider } from '@app-foundry/core';
import {
  AiRuntimeModule,
  AI_CIPHER,
  AI_METRICS,
  AI_NOTIFIER,
  AI_REGISTRY,
  type AiMetricsPort,
} from '@app-foundry/ai-runtime';
import { createDb, type DbHandle } from '@app-foundry/db';
import { type Env, loadEnv } from '@app-foundry/env';
import {
  NOTIFICATION_METRICS,
  NotificationEmitter,
  NotificationEmitterModule,
  type NotificationMetricsPort,
} from '@app-foundry/notifications';
import { DATABASE, DB_HANDLE, ENV, REDIS } from '@app-foundry/platform';

/**
 * Las métricas del worker, de momento, no salen a ningún sitio.
 *
 * Se registran en el log y se acabó. Es una carencia con nombre y no un
 * descuido: los paneles de Grafana son H14, y el exportador de OpenTelemetry
 * que tiene la API monta un proceso entero que aquí todavía no hace falta.
 * Puesto como puerto, cambiarlo es sustituir esta clase.
 */
class WorkerMetrics implements AiMetricsPort, NotificationMetricsPort {
  private readonly log = new Logger('WorkerMetrics');

  invocacionIa(datos: { provider: string; model: string; task: string; outcome: string }): void {
    this.log.log(datos, 'invocación');
  }
  cortacircuitosAbierto(provider: string): void {
    this.log.warn({ provider }, 'cortacircuitos abierto');
  }
  cortacircuitosCerrado(provider: string): void {
    this.log.log({ provider }, 'cortacircuitos cerrado');
  }
  avisosEmitidos(cuantos: number): void {
    this.log.log({ cuantos }, 'avisos emitidos');
  }
}

/**
 * Lo que el worker necesita para invocar a un modelo y avisar.
 *
 * Es el mismo montaje que hace la API, con las mismas piezas y por los mismos
 * tokens: el registro de adaptadores —incluido el proveedor de mentira, que
 * entra por aquí y por ningún otro sitio (T-36)—, el cifrador de credenciales y
 * los dos puertos. Que ambos procesos monten lo mismo es justamente lo que hace
 * que la reserva de cupo y el registro de invocaciones no se dupliquen (RD-10).
 */
@Global()
@Module({
  imports: [
    AiRuntimeModule.forRoot({
      providers: [
        { provide: AI_METRICS, useClass: WorkerMetrics },
        {
          provide: AI_NOTIFIER,
          useExisting: NotificationEmitter,
        },
        {
          provide: AI_REGISTRY,
          inject: [ENV],
          useFactory: (env: Env): ProviderRegistry => {
            if (env.AI_USE_FAKE_PROVIDER && env.NODE_ENV !== 'production') {
              new Logger('WorkerAi').warn(
                'AI_USE_FAKE_PROVIDER activo: ningún modelo real será invocado, ' +
                  'las respuestas son de mentira',
              );
              return createProviderRegistry([
                new FakeProvider({ id: AiProvider.ANTHROPIC }),
                new FakeProvider({ id: AiProvider.GROQ, capabilities: { webSearch: false } }),
              ]);
            }
            return createProviderRegistry([new AnthropicProvider(), new GroqProvider()]);
          },
        },
        {
          provide: AI_CIPHER,
          inject: [ENV],
          useFactory: (env: Env): CredentialCipher | null => {
            if (!env.AI_CREDENTIAL_KEYS) {
              new Logger('WorkerAi').log(
                'Sin AI_CREDENTIAL_KEYS: no se podrán leer credenciales de proveedor',
              );
              return null;
            }
            return new CredentialCipher(parseKeyRing(env.AI_CREDENTIAL_KEYS));
          },
        },
      ],
    }),
    NotificationEmitterModule.forRoot({
      providers: [{ provide: NOTIFICATION_METRICS, useClass: WorkerMetrics }],
    }),
  ],
  providers: [
    { provide: ENV, useFactory: (): Env => loadEnv() },
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env): DbHandle => createDb(env.DATABASE_URL),
    },
    { provide: DATABASE, inject: [DB_HANDLE], useFactory: (handle: DbHandle) => handle.db },
    {
      provide: REDIS,
      inject: [ENV],
      /*
       * `maxRetriesPerRequest: null` porque BullMQ bloquea en Redis esperando
       * trabajo: con reintentos limitados, una desconexión pasajera mataría al
       * consumidor en vez de esperar a que Redis vuelva.
       */
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    },
  ],
  exports: [ENV, DATABASE, DB_HANDLE, REDIS, AiRuntimeModule, NotificationEmitterModule],
})
export class WorkerAiModule {}
