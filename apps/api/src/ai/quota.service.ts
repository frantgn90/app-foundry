import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { AiProvider } from '@app-foundry/core';

import { REDIS } from '../infrastructure/tokens.js';
import { AiUsageRepository } from './usage.repository.js';
import { LIQUIDAR, RESERVAR } from './quota.scripts.js';

/** Dos meses de vida: cuando el mes siguiente está bien entrado, el viejo sobra. */
const TTL_SEGUNDOS = 70 * 24 * 60 * 60;
/** Cuánto vive una reserva sin liquidar antes de considerarse abandonada. */
const VIGENCIA_MS = 15 * 60 * 1000;

export interface QuotaKey {
  readonly workspaceId: string;
  readonly provider: AiProvider;
}

export interface Reservation {
  readonly id: string;
  readonly estimatedTokens: number;
}

export interface QuotaState {
  readonly spent: number;
  readonly reserved: number;
  /** Nulo cuando no hay cupo fijado. */
  readonly quota: number | null;
}

export class QuotaExceededError extends Error {
  constructor(readonly state: QuotaState) {
    super('El cupo mensual de tokens de este proveedor está agotado');
    this.name = 'QuotaExceededError';
  }
}

/**
 * El contador de consumo (T-30, TRD v2 §9).
 *
 * Vive en Redis porque el incremento atómico resuelve la carrera sin tocar la
 * base de datos en el camino caliente. La **verdad** sigue siendo la tabla de
 * invocaciones: esto es una caché derivable, y de ahí se reconstruye.
 *
 * El ciclo es reservar → invocar → liquidar. Se reserva el **techo** estimado,
 * no lo que se espera gastar, para que cinco invocaciones simultáneas no se
 * cuelen todas por el mismo hueco.
 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger(AiQuotaService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly usage: AiUsageRepository,
  ) {}

  /**
   * Aparta el techo estimado, si cabe.
   *
   * Lanza `QuotaExceededError` cuando no cabe: no se invoca a nadie y quien lo
   * pidió recibe un motivo, no un fallo del proveedor.
   */
  async reserve(
    key: QuotaKey,
    estimatedTokens: number,
    quota: number | null,
    now: number,
  ): Promise<Reservation> {
    const id = `${String(now)}-${Math.random().toString(36).slice(2, 10)}`;
    const claves = this.keys(key, now);
    const siembra = await this.seedIfMissing(key, claves[0], now);

    const resultado = (await this.redis.eval(
      RESERVAR,
      3,
      ...claves,
      String(estimatedTokens),
      String(quota ?? -1),
      id,
      String(now + VIGENCIA_MS),
      String(TTL_SEGUNDOS),
      siembra,
      String(now),
    )) as [number, number, number, number];

    const [concedida, spent, reserved, cupo] = resultado;
    if (concedida !== 1) {
      throw new QuotaExceededError({ spent, reserved, quota: cupo < 0 ? null : cupo });
    }

    return { id, estimatedTokens };
  }

  /**
   * Convierte la reserva en gasto real.
   *
   * Se llama **siempre**, también cuando la invocación falla: lo consumido antes
   * de fallar se consumió igual, y una reserva sin liquidar deja cupo comido
   * hasta que la barra.
   */
  async settle(
    key: QuotaKey,
    reservationId: string,
    realTokens: number,
    now: number,
  ): Promise<void> {
    const liquidada = (await this.redis.eval(
      LIQUIDAR,
      3,
      ...this.keys(key, now),
      reservationId,
      String(Math.max(0, realTokens)),
    )) as number;

    if (liquidada !== 1) {
      /*
       * Que no hubiera nada que liquidar significa que la reserva venció y el
       * barrido ya la soltó. El gasto real queda en la tabla de invocaciones, y
       * la conciliación corregirá el contador: aquí solo se anota.
       */
      this.logger.warn(
        `Reserva ${reservationId} liquidada fuera de plazo: el contador se corregirá al conciliar`,
      );
    }
  }

  /**
   * Reconstruye el contador desde el registro cuando Redis no sabe nada (§9.3).
   *
   * Pasa más de lo que parece: un reinicio sin fichero, un vaciado, una
   * instancia nueva. Si el contador arrancara en cero, el cupo del mes se
   * duplicaría en silencio, que es justo lo que un techo de gasto no puede
   * hacer.
   *
   * Se agrega solo cuando falta el dato, y la siembra viaja dentro del propio
   * guion de reserva para que sembrar y reservar sean un mismo acto.
   */
  private async seedIfMissing(key: QuotaKey, counterKey: string, now: number): Promise<string> {
    const existe = await this.redis.hexists(counterKey, 'spent');
    if (existe === 1) return '';

    const gastado = await this.usage.spentInMonth(
      key.workspaceId,
      key.provider,
      AiQuotaService.month(now),
    );
    if (gastado > 0) {
      this.logger.log(
        `Contador de ${key.provider} reconstruido desde el registro: ${String(gastado)} tokens`,
      );
    }
    return String(gastado);
  }

  /** Lo gastado y lo reservado de un mes. */
  async state(key: QuotaKey, quota: number | null, now: number): Promise<QuotaState> {
    const [spent, reserved] = await this.redis.hmget(this.keys(key, now)[0], 'spent', 'reserved');
    return { spent: Number(spent ?? 0), reserved: Number(reserved ?? 0), quota };
  }

  /**
   * Traduce la caída de Redis en un rechazo, no en un permiso.
   *
   * Con la cuota de un tercero de por medio, la duda se resuelve a favor del
   * dueño de la clave (T-31).
   */
  static failClosed(error: unknown): never {
    if (error instanceof QuotaExceededError) throw error;
    throw new ServiceUnavailableException(
      'No se ha podido comprobar el cupo de tokens, así que no se ha invocado nada',
    );
  }

  /** El mes se cuenta en UTC, y así se dice en la interfaz. */
  static month(now: number): string {
    return new Date(now).toISOString().slice(0, 7);
  }

  private keys(key: QuotaKey, now: number): [string, string, string] {
    const base = `quota:${key.workspaceId}:${key.provider}:${AiQuotaService.month(now)}`;
    return [base, `${base}:resv`, `${base}:deadlines`];
  }
}
