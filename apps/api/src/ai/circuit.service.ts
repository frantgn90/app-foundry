import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Redis } from 'ioredis';

import { type AiProvider, ProviderErrorKind } from '@app-foundry/core';

import { REDIS } from '../infrastructure/tokens.js';
import { MetricsService } from '../observability/metrics.service.js';

/** Cuántos fallos seguidos hacen falta para dejar de intentarlo. */
const UMBRAL = 5;
/** Cuánto se deja de llamar antes de volver a probar. */
const ESPERA_MS = 30_000;
/** Cuánto vive la cuenta de fallos sin que llegue otro. */
const VENTANA_SEGUNDOS = 120;

/**
 * El cortacircuitos por proveedor (RNF-704, TRD §11.2).
 *
 * Cuando un proveedor lleva un rato fallando sin parar, seguir llamándolo no
 * arregla nada: alarga cada petición hasta el tiempo de espera, gasta reintentos
 * y, si el fallo era por ritmo, empeora justo lo que había que dejar en paz. Lo
 * que se gana abriéndolo es una respuesta **inmediata y con motivo** —«el
 * proveedor no responde»— en vez de un fallo genérico al cabo de medio minuto.
 *
 * **Qué cuenta como fallo del proveedor.** Solo `TRANSIENT` y `RATE_LIMIT`. Un
 * `AUTH` es una credencial mal puesta en **un** workspace, y el contador es
 * global a la instancia: dejar que lo abriera significaría que una clave
 * caducada de alguien apaga la IA de todos los demás. Lo mismo con
 * `CONTEXT_OVERFLOW` o `SCHEMA`, que hablan de lo que enviamos y no de quién lo
 * recibe.
 *
 * Vive en Redis porque el proveedor es el mismo para todas las instancias: si
 * cada una llevara su cuenta, haría falta que todas se estrellaran por separado
 * antes de dejar de llamarlo.
 */
@Injectable()
export class AiCircuitService {
  private readonly logger = new Logger(AiCircuitService.name);

  /**
   * Los que **este** proceso ve abiertos.
   *
   * La métrica sube y baja, así que hay que emparejar cada subida con su bajada;
   * y el estado está en Redis, que puede cerrarse solo al vencer. Este conjunto
   * es lo que sabe este proceso, y se corrige cada vez que consulta.
   */
  private readonly abiertos = new Set<AiProvider>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Corta antes de invocar si el proveedor está fuera de servicio.
   *
   * Si Redis no contesta, **se deja pasar**. Es la decisión contraria a la del
   * cupo (T-31) y por un motivo distinto: allí lo que estaba en juego era gastar
   * dinero ajeno sin saber si quedaba, y aquí solo una optimización. Negarse
   * porque no se puede consultar el cortacircuitos convertiría una caída de
   * Redis en una caída de la IA.
   */
  async assertClosed(provider: AiProvider): Promise<void> {
    let abierto: string | null;
    try {
      abierto = await this.redis.get(this.clave(provider, 'open'));
    } catch (error) {
      this.logger.warn({ err: error }, 'No se ha podido consultar el cortacircuitos');
      return;
    }

    this.reflejar(provider, abierto !== null);
    if (abierto === null) return;

    throw new ServiceUnavailableException(
      `${provider} lleva un rato sin responder, así que no se le está llamando. Inténtalo de nuevo en unos segundos.`,
    );
  }

  /** Una invocación que ha ido bien borra la cuenta: los fallos son consecutivos. */
  async recordSuccess(provider: AiProvider): Promise<void> {
    try {
      await this.redis.del(this.clave(provider, 'fails'), this.clave(provider, 'open'));
    } catch (error) {
      this.logger.warn({ err: error }, 'No se ha podido cerrar el cortacircuitos');
      return;
    }
    this.reflejar(provider, false);
  }

  /** Un fallo suyo acerca el corte; uno nuestro no cuenta. */
  async recordFailure(provider: AiProvider, kind: ProviderErrorKind): Promise<void> {
    if (kind !== ProviderErrorKind.TRANSIENT && kind !== ProviderErrorKind.RATE_LIMIT) return;

    try {
      const clave = this.clave(provider, 'fails');
      const fallos = await this.redis.incr(clave);
      if (fallos === 1) await this.redis.expire(clave, VENTANA_SEGUNDOS);
      if (fallos < UMBRAL) return;

      await this.redis.set(this.clave(provider, 'open'), String(fallos), 'PX', ESPERA_MS);
      if (!this.abiertos.has(provider)) {
        this.logger.warn(
          `Cortacircuitos abierto para ${provider}: ${String(fallos)} fallos seguidos`,
        );
      }
      this.reflejar(provider, true);
    } catch (error) {
      this.logger.warn({ err: error }, 'No se ha podido apuntar el fallo del proveedor');
    }
  }

  /** Pone la métrica al día con lo que acaba de verse, sin contar dos veces. */
  private reflejar(provider: AiProvider, abierto: boolean): void {
    if (abierto && !this.abiertos.has(provider)) {
      this.abiertos.add(provider);
      this.metrics.cortacircuitosAbierto(provider);
      return;
    }
    if (!abierto && this.abiertos.has(provider)) {
      this.abiertos.delete(provider);
      this.metrics.cortacircuitosCerrado(provider);
    }
  }

  private clave(provider: AiProvider, que: 'fails' | 'open'): string {
    return `ai:circuit:${provider}:${que}`;
  }
}
