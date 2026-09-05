import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, gt } from 'drizzle-orm';
import type { Request, Response } from 'express';

import { type Database, notifications } from '@app-foundry/db';

import { conIdentidad } from '@app-foundry/ai-runtime';
import { currentTx } from '@app-foundry/ai-runtime';
import { DATABASE } from '../infrastructure/tokens.js';
import { MetricsService } from '../observability/metrics.service.js';
import type { EventoAviso } from './notifications.stream.js';
import { NotificationsStream } from './notifications.stream.js';

/** Cada cuánto se manda señal de vida. Por debajo del minuto de casi todo proxy. */
const LATIDO_MS = 25_000;

@Injectable()
export class NotificationsChannel {
  private readonly logger = new Logger(NotificationsChannel.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly stream: NotificationsStream,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Mantiene abierta una conexión de avisos.
   *
   * El navegador reconecta solo cuando se corta, y manda en `Last-Event-ID` el
   * último que recibió; con eso se le reenvía lo que se perdió mientras estuvo
   * desconectado. Sin esa parte, la reconexión automática daría una falsa
   * sensación de continuidad: la conexión vuelve, pero el hueco no se rellena.
   */
  async abrir(
    userId: string,
    request: Request,
    response: Response,
    lastEventId?: string,
  ): Promise<void> {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desactiva el buffer de nginx, que si no retiene los eventos hasta
      // juntar un bloque y convierte el tiempo real en ráfagas.
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    // Se le dice al navegador cuánto esperar antes de reintentar, para que no
    // machaque al servidor si es este el que se ha caído.
    response.write('retry: 5000\n\n');

    if (lastEventId) await this.reenviarPerdidos(userId, lastEventId, response);

    const baja = this.stream.escuchar(userId, (evento) => {
      this.enviar(response, evento);
    });
    this.metrics.conexionAbierta();

    const latido = setInterval(() => {
      // Un comentario vacío: no es un evento, solo tráfico para que nadie dé la
      // conexión por muerta.
      response.write(': ping\n\n');
    }, LATIDO_MS);

    let cerrada = false;
    const cerrar = (): void => {
      // Puede llegar por dos vías —cierre y error—, y contar la baja dos veces
      // dejaría el número de conexiones abiertas en negativo.
      if (cerrada) return;
      cerrada = true;
      clearInterval(latido);
      baja();
      this.metrics.conexionCerrada();
    };
    request.on('close', cerrar);
    response.on('error', cerrar);
  }

  /**
   * Reenvía lo ocurrido desde el último evento recibido.
   *
   * La comparación es por identificador y no por fecha porque son UUIDv7:
   * ordenan igual que el tiempo, así que «posterior a este» es una comparación
   * directa, sin depender de relojes ni de empates en el mismo milisegundo.
   */
  private async reenviarPerdidos(
    userId: string,
    lastEventId: string,
    response: Response,
  ): Promise<void> {
    try {
      const perdidos = await conIdentidad(this.db, userId, async () =>
        currentTx()
          .select({
            id: notifications.id,
            type: notifications.type,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .where(gt(notifications.id, lastEventId))
          .orderBy(asc(notifications.id))
          .limit(100),
      );

      for (const fila of perdidos) {
        this.enviar(response, {
          id: fila.id,
          type: fila.type,
          createdAt: fila.createdAt.toISOString(),
        });
      }
    } catch (error) {
      // Un `Last-Event-ID` inservible no puede impedir conectarse: se sigue
      // adelante y el cliente se pondrá al día al recargar la lista.
      this.logger.warn({ err: error }, 'No se pudo reenviar lo perdido');
    }
  }

  private enviar(response: Response, evento: EventoAviso): void {
    response.write(`id: ${evento.id}\n`);
    response.write(`event: notification\n`);
    response.write(`data: ${JSON.stringify(evento)}\n\n`);
  }
}
