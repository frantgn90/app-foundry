import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiQuotaService, QuotaExceededError } from '../src/ai/quota.service.js';
import { type Harness, startHarness } from './harness.js';

/**
 * El contador de cupo, contra un Redis real.
 *
 * Lo que se comprueba aquí no se puede comprobar con un doble: que la
 * comprobación y la reserva son un solo acto. Con un Redis simulado, cualquier
 * implementación pasaría.
 */
let h: Harness;
let redis: Redis;
let quota: AiQuotaService;

const AHORA = Date.UTC(2026, 8, 15, 12, 0, 0);
let siguiente = 0;
const clave = () => ({ workspaceId: `ws-${String(siguiente++)}`, provider: 'ANTHROPIC' as const });

beforeAll(async () => {
  h = await startHarness();
  redis = new Redis(h.redisUrl);
  quota = new AiQuotaService(redis);
}, 240_000);

afterAll(async () => {
  await redis.quit();
  await h.stop();
});

describe('reservar', () => {
  it('sin cupo fijado se reserva siempre', async () => {
    const k = clave();

    await expect(quota.reserve(k, 1_000_000, null, AHORA)).resolves.toMatchObject({
      estimatedTokens: 1_000_000,
    });
  });

  it('con cupo, se reserva mientras quepa', async () => {
    const k = clave();

    await quota.reserve(k, 600, 1_000, AHORA);
    await expect(quota.reserve(k, 300, 1_000, AHORA)).resolves.toBeDefined();
  });

  it('lo que no cabe se rechaza con el estado, no con un fallo genérico', async () => {
    const k = clave();
    await quota.reserve(k, 900, 1_000, AHORA);

    const error = await quota.reserve(k, 200, 1_000, AHORA).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError).state).toMatchObject({ reserved: 900, quota: 1_000 });
  });

  /*
   * El motivo de que esto vaya en Lua. Con una lectura y una escritura
   * separadas, las cinco invocaciones de una revisión leen «cabe» antes de que
   * ninguna haya apuntado nada, y las cinco se cuelan por el hueco de una.
   */
  it('cinco reservas simultáneas no se saltan el cupo entre todas', async () => {
    const k = clave();

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        quota.reserve(k, 400, 1_000, AHORA).then(
          () => 'concedida',
          () => 'rechazada',
        ),
      ),
    );

    expect(resultados.filter((r) => r === 'concedida')).toHaveLength(2);
    expect((await quota.state(k, 1_000, AHORA)).reserved).toBe(800);
  });
});

describe('liquidar', () => {
  it('la reserva se convierte en lo que de verdad se gastó', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 1_000, 10_000, AHORA);

    await quota.settle(k, reserva.id, 250, AHORA);

    expect(await quota.state(k, 10_000, AHORA)).toMatchObject({ spent: 250, reserved: 0 });
  });

  /*
   * Se liquida también cuando la invocación falla: lo consumido antes de fallar
   * se consumió igual, y una reserva sin liquidar deja cupo comido.
   */
  it('liquidar a cero libera la reserva sin apuntar gasto', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 1_000, 10_000, AHORA);

    await quota.settle(k, reserva.id, 0, AHORA);

    expect(await quota.state(k, 10_000, AHORA)).toMatchObject({ spent: 0, reserved: 0 });
  });

  /*
   * Sin idempotencia, un reintento restaría dos veces del reservado y el
   * contador acabaría en números imposibles.
   */
  it('liquidar dos veces la misma reserva no descuadra el contador', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 1_000, 10_000, AHORA);

    await quota.settle(k, reserva.id, 300, AHORA);
    await quota.settle(k, reserva.id, 300, AHORA);

    expect(await quota.state(k, 10_000, AHORA)).toMatchObject({ spent: 300, reserved: 0 });
  });

  it('lo gastado libera sitio para la siguiente', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 900, 1_000, AHORA);
    await quota.settle(k, reserva.id, 100, AHORA);

    await expect(quota.reserve(k, 800, 1_000, AHORA)).resolves.toBeDefined();
  });
});

describe('el mes', () => {
  it('se cuenta en UTC', () => {
    expect(AiQuotaService.month(Date.UTC(2026, 8, 1, 0, 0, 0))).toBe('2026-09');
    expect(AiQuotaService.month(Date.UTC(2026, 8, 30, 23, 59, 59))).toBe('2026-09');
  });

  it('lo gastado en un mes no cuenta en el siguiente', async () => {
    const k = clave();
    await quota.reserve(k, 900, 1_000, AHORA);

    const mesQueViene = Date.UTC(2026, 9, 1, 0, 0, 0);
    await expect(quota.reserve(k, 900, 1_000, mesQueViene)).resolves.toBeDefined();
  });
});
