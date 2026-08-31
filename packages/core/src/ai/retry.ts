import { ProviderErrorKind } from './enums.js';

/**
 * Qué hacer cuando un proveedor falla (RNF-703).
 *
 * La decisión se deriva del `kind` y de nada más. Sin una política común, cada
 * adaptador acabaría inventando la suya, y hay dos formas de equivocarse que
 * cuestan dinero: reintentar lo que nunca va a funcionar —una credencial
 * revocada solo acumula fallos y acerca el bloqueo del proveedor— y no
 * reintentar lo que se habría arreglado solo.
 */
export interface RetryPolicy {
  /** Intentos en total, contando el primero. Uno significa «sin reintento». */
  readonly maxAttempts: number;
  /** Espera del primer reintento, que se duplica en cada uno siguiente. */
  readonly baseDelayMs: number;
  /** Techo de la espera, para que el crecimiento exponencial no se dispare. */
  readonly maxDelayMs: number;
}

const SIN_REINTENTO: RetryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };

export function retryPolicyFor(kind: ProviderErrorKind): RetryPolicy {
  switch (kind) {
    /*
     * El proveedor pide bajar el ritmo, así que se espera más y se insiste más:
     * es el único fallo que se arregla precisamente por esperar.
     */
    case ProviderErrorKind.RATE_LIMIT:
      return { maxAttempts: 4, baseDelayMs: 2_000, maxDelayMs: 30_000 };

    /* Un corte o un 5xx pasajero. Se insiste poco y pronto. */
    case ProviderErrorKind.TRANSIENT:
      return { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

    /*
     * Una sola segunda oportunidad. El modelo incumplió un esquema que se le
     * dio: puede ser mala suerte de una generación, pero si vuelve a fallar el
     * problema es el esquema o el modelo, y repetir solo gasta cuota.
     */
    case ProviderErrorKind.SCHEMA:
      return { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 };

    /*
     * Ninguno de estos mejora repitiendo: la credencial seguirá revocada, el
     * texto seguirá sin caber, el modelo seguirá sin existir, la negativa
     * seguirá siendo una negativa, y lo cancelado se canceló a propósito.
     */
    case ProviderErrorKind.AUTH:
    case ProviderErrorKind.CONTEXT_OVERFLOW:
    case ProviderErrorKind.CONTENT_FILTER:
    case ProviderErrorKind.CANCELLED:
    case ProviderErrorKind.MODEL_UNAVAILABLE:
      return SIN_REINTENTO;
  }
}

export function isRetryable(kind: ProviderErrorKind): boolean {
  return retryPolicyFor(kind).maxAttempts > 1;
}

export interface DelayOptions {
  /** Lo que el propio proveedor pidió esperar, si lo dijo. Manda sobre el cálculo. */
  readonly retryAfterMs?: number;
  /** Inyectable para poder probar la espera sin azar. */
  readonly random?: () => number;
}

/**
 * Cuánto esperar antes del intento número `attempt` (el primero es el 1).
 *
 * Espera creciente con **azar completo**: se sortea dentro del intervalo en vez
 * de esperar siempre lo mismo. Sin ese azar, varias invocaciones que fallan a la
 * vez —una revisión con cinco agentes, por ejemplo— reintentan todas en el mismo
 * instante y vuelven a tumbar al proveedor que estaban esperando a que se
 * recuperase.
 *
 * Si el proveedor dijo cuánto esperar, se le hace caso: sabe más que nosotros
 * sobre cuándo va a volver a aceptar la petición.
 */
export function delayForAttempt(
  policy: RetryPolicy,
  attempt: number,
  options: DelayOptions = {},
): number {
  if (attempt <= 1 || policy.maxAttempts <= 1) return 0;

  const random = options.random ?? Math.random;

  if (options.retryAfterMs !== undefined) {
    return Math.min(options.retryAfterMs, policy.maxDelayMs);
  }

  const exponencial = policy.baseDelayMs * 2 ** (attempt - 2);
  return Math.round(random() * Math.min(exponencial, policy.maxDelayMs));
}

/** Si queda otro intento después del número `attempt`. */
export function hasAttemptsLeft(policy: RetryPolicy, attempt: number): boolean {
  return attempt < policy.maxAttempts;
}
