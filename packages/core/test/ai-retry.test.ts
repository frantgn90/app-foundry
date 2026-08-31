import { describe, expect, it } from 'vitest';

import { ProviderErrorKind } from '../src/ai/enums.js';
import { delayForAttempt, hasAttemptsLeft, isRetryable, retryPolicyFor } from '../src/ai/retry.js';

describe('qué se reintenta y qué no', () => {
  /*
   * El caso que más caro sale de equivocar: insistir contra una credencial
   * revocada no la desrevoca, y acerca el bloqueo del proveedor (RNF-703).
   */
  it('una credencial inválida no se reintenta jamás', () => {
    expect(isRetryable(ProviderErrorKind.AUTH)).toBe(false);
    expect(retryPolicyFor(ProviderErrorKind.AUTH).maxAttempts).toBe(1);
  });

  it('lo pasajero y el exceso de ritmo sí se reintentan', () => {
    expect(isRetryable(ProviderErrorKind.TRANSIENT)).toBe(true);
    expect(isRetryable(ProviderErrorKind.RATE_LIMIT)).toBe(true);
  });

  it('quien pide bajar el ritmo recibe más paciencia que un corte pasajero', () => {
    const ritmo = retryPolicyFor(ProviderErrorKind.RATE_LIMIT);
    const pasajero = retryPolicyFor(ProviderErrorKind.TRANSIENT);

    expect(ritmo.maxAttempts).toBeGreaterThan(pasajero.maxAttempts);
    expect(ritmo.baseDelayMs).toBeGreaterThan(pasajero.baseDelayMs);
  });

  it('un esquema incumplido tiene una segunda oportunidad, y solo una', () => {
    expect(retryPolicyFor(ProviderErrorKind.SCHEMA).maxAttempts).toBe(2);
  });

  it('nada de lo que no mejora repitiendo se repite', () => {
    for (const kind of [
      ProviderErrorKind.CONTEXT_OVERFLOW,
      ProviderErrorKind.CONTENT_FILTER,
      ProviderErrorKind.CANCELLED,
      ProviderErrorKind.MODEL_UNAVAILABLE,
    ]) {
      expect(isRetryable(kind)).toBe(false);
    }
  });
});

describe('cuánto se espera entre intentos', () => {
  const ritmo = retryPolicyFor(ProviderErrorKind.RATE_LIMIT);

  it('antes del primer intento no se espera', () => {
    expect(delayForAttempt(ritmo, 1)).toBe(0);
  });

  it('una política sin reintento nunca espera', () => {
    expect(delayForAttempt(retryPolicyFor(ProviderErrorKind.AUTH), 2)).toBe(0);
  });

  it('la espera crece con cada intento', () => {
    const sinAzar = { random: () => 1 };
    const segundo = delayForAttempt(ritmo, 2, sinAzar);
    const tercero = delayForAttempt(ritmo, 3, sinAzar);

    expect(tercero).toBeGreaterThan(segundo);
  });

  it('la espera no pasa del techo por mucho que crezca', () => {
    const decimo = delayForAttempt(ritmo, 10, { random: () => 1 });
    expect(decimo).toBe(ritmo.maxDelayMs);
  });

  /*
   * Sin azar, cinco agentes que fallan a la vez reintentan en el mismo
   * instante y vuelven a tumbar al proveedor que esperaban recuperar.
   */
  it('el azar reparte los reintentos dentro del intervalo', () => {
    expect(delayForAttempt(ritmo, 3, { random: () => 0 })).toBe(0);
    expect(delayForAttempt(ritmo, 3, { random: () => 0.5 })).toBeGreaterThan(0);
    expect(delayForAttempt(ritmo, 3, { random: () => 0.5 })).toBeLessThan(
      delayForAttempt(ritmo, 3, { random: () => 1 }),
    );
  });

  it('si el proveedor dice cuánto esperar, se le hace caso', () => {
    expect(delayForAttempt(ritmo, 2, { retryAfterMs: 7_000 })).toBe(7_000);
  });

  it('pero ni siquiera él consigue que se espere más que el techo', () => {
    expect(delayForAttempt(ritmo, 2, { retryAfterMs: 10 * 60_000 })).toBe(ritmo.maxDelayMs);
  });
});

describe('cuándo parar', () => {
  it('se agotan los intentos que declara la política', () => {
    const pasajero = retryPolicyFor(ProviderErrorKind.TRANSIENT);

    expect(hasAttemptsLeft(pasajero, 1)).toBe(true);
    expect(hasAttemptsLeft(pasajero, pasajero.maxAttempts - 1)).toBe(true);
    expect(hasAttemptsLeft(pasajero, pasajero.maxAttempts)).toBe(false);
  });
});
