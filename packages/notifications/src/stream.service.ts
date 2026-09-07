import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS } from '@app-foundry/platform';

/** Lo que viaja por el canal: lo justo para que el navegador vaya a por el resto. */
export interface EventoAviso {
  id: string;
  type: string;
  createdAt: string;
}

/**
 * Cómo va una revisión, para quien esté mirando esa app (RF-1609).
 *
 * Va por el mismo canal que los avisos y no por uno nuevo: el navegador ya
 * tiene una conexión abierta por pestaña, y una segunda para lo mismo sería
 * otra conexión que mantener por cada persona que abre una ficha.
 *
 * Lo distingue `kind`, que es lo que el otro extremo traduce a un tipo de
 * evento distinto: quien escucha avisos no tiene por qué enterarse de esto, y
 * al revés.
 */
export interface EventoRevision {
  kind: 'review';
  reviewId: string;
  appId: string;
  status: string;
  /** Cuántos agentes han terminado y cuántos son, que es el progreso. */
  done: number;
  total: number;
}

/** Lo que puede llegar por el canal de una persona. */
export type MensajeCanal = EventoAviso | EventoRevision;

type Oyente = (mensaje: MensajeCanal) => void;

const CANAL = 'notif:user:';

/**
 * Reparte los avisos a las conexiones abiertas, pasando por Redis.
 *
 * Con una sola instancia de la API esto sobraría: bastaría un mapa en memoria.
 * Pasa por Redis porque en cuanto haya dos, una persona estará conectada a una
 * de ellas y el aviso lo generará la otra, y entonces no llega. Añadirlo después
 * significa rehacer esta pieza y el cliente que la consume (TRD §11, T-6).
 *
 * La suscripción es una sola por instancia, con patrón, en lugar de una por
 * usuario conectado: suscribirse y desuscribirse en cada conexión y cada
 * desconexión multiplicaría el trabajo de Redis sin ganar nada, porque el
 * reparte fino ya lo hace el mapa local.
 */
@Injectable()
export class NotificationsStream implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsStream.name);
  private readonly oyentes = new Map<string, Set<Oyente>>();
  private suscriptor: Redis | null = null;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    // Una conexión suscrita no admite otros comandos, así que el reparto usa la
    // suya propia y la compartida se queda para publicar y para lo demás.
    this.suscriptor = this.redis.duplicate();
    this.suscriptor.on('pmessage', (_patron, canal, mensaje) => {
      this.repartir(canal.slice(CANAL.length), mensaje);
    });
    this.suscriptor.on('error', (error: Error) => {
      // Sin esto, un corte de Redis tumbaría el proceso con un error no
      // capturado. ioredis reconecta solo; mientras tanto los avisos siguen
      // guardándose y se ven al recargar.
      this.logger.warn({ err: error }, 'La conexión de reparto tuvo un problema');
    });

    try {
      await this.suscriptor.psubscribe(`${CANAL}*`);
    } catch (error) {
      this.logger.error({ err: error }, 'No se pudo suscribir al canal de avisos');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.suscriptor?.quit().catch(() => undefined);
  }

  /** Publica un aviso para que llegue a donde esté conectada esa persona. */
  async publicar(userId: string, evento: EventoAviso): Promise<void> {
    await this.redis.publish(`${CANAL}${userId}`, JSON.stringify(evento));
  }

  /**
   * Reparte el progreso de una revisión a quienes pueden verla (RF-1609).
   *
   * La audiencia la resuelve quien publica, no este servicio: aquí no hay forma
   * de saber quién ve una app sin consultar la base, y el reparto fino ya lo
   * hace el mapa local de cada instancia. Quien no esté conectado no se entera,
   * y no pasa nada: al abrir la ficha, el estado viene con ella.
   */
  async publicarRevision(userIds: readonly string[], evento: EventoRevision): Promise<void> {
    const mensaje = JSON.stringify(evento);
    for (const userId of userIds) {
      await this.redis.publish(`${CANAL}${userId}`, mensaje);
    }
  }

  /** Registra una conexión y devuelve cómo darla de baja. */
  escuchar(userId: string, oyente: Oyente): () => void {
    const suyos = this.oyentes.get(userId) ?? new Set<Oyente>();
    suyos.add(oyente);
    this.oyentes.set(userId, suyos);

    return () => {
      suyos.delete(oyente);
      // El mapa se vacía al irse el último: si no, una instancia con mucho
      // trasiego acumularía una entrada por cada persona que pasó por ella.
      if (suyos.size === 0) this.oyentes.delete(userId);
    };
  }

  /** Cuántas conexiones hay abiertas ahora mismo, para la métrica (TRD §13). */
  get conexiones(): number {
    let total = 0;
    for (const suyos of this.oyentes.values()) total += suyos.size;
    return total;
  }

  private repartir(userId: string, mensaje: string): void {
    const suyos = this.oyentes.get(userId);
    if (!suyos || suyos.size === 0) return;

    let evento: MensajeCanal;
    try {
      evento = JSON.parse(mensaje) as MensajeCanal;
    } catch {
      this.logger.warn('Llegó un mensaje que no se pudo interpretar');
      return;
    }

    for (const oyente of suyos) oyente(evento);
  }
}
