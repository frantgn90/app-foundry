import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiQuotaService, QuotaExceededError, RateLimitedError } from '../src/ai/quota.service.js';
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

/**
 * Lo que dice el registro de invocaciones.
 *
 * Va suplantado porque aquí se prueba el contador, no la consulta: lo que
 * importa es qué hace el contador **cuando** el registro dice algo, y eso se
 * controla mejor diciéndoselo.
 */
const registro = { total: 0 };
const usage = {
  spentInMonth: () => Promise.resolve(registro.total),
} as unknown as ConstructorParameters<typeof AiQuotaService>[1];

const AHORA = Date.UTC(2026, 8, 15, 12, 0, 0);
let siguiente = 0;
const clave = () => ({ workspaceId: `ws-${String(siguiente++)}`, provider: 'ANTHROPIC' as const });

beforeAll(async () => {
  h = await startHarness();
  redis = new Redis(h.redisUrl);
  quota = new AiQuotaService(redis, usage);
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

describe('cuando Redis no sabe nada', () => {
  /*
   * Pasa más de lo que parece: un reinicio sin fichero, un vaciado, una
   * instancia nueva. Si el contador arrancara en cero, el cupo del mes se
   * duplicaría en silencio, que es justo lo que un techo de gasto no puede
   * hacer (§9.3).
   */
  it('el contador se reconstruye desde el registro', async () => {
    const k = clave();
    registro.total = 900;

    await expect(quota.reserve(k, 200, 1_000, AHORA)).rejects.toBeInstanceOf(QuotaExceededError);
    expect((await quota.state(k, 1_000, AHORA)).spent).toBe(900);

    registro.total = 0;
  });

  it('vaciar la clave no regala cupo: se vuelve a reconstruir', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 500, 1_000, AHORA);
    await quota.settle(k, reserva.id, 500, AHORA);
    expect((await quota.state(k, 1_000, AHORA)).spent).toBe(500);

    /* Como si Redis se hubiera reiniciado sin fichero. */
    await redis.del(`quota:${k.workspaceId}:${k.provider}:2026-09`);
    registro.total = 500;

    await expect(quota.reserve(k, 600, 1_000, AHORA)).rejects.toBeInstanceOf(QuotaExceededError);

    registro.total = 0;
  });

  it('con el registro también vacío, se empieza de cero y no se bloquea nada', async () => {
    const k = clave();
    registro.total = 0;

    await expect(quota.reserve(k, 1_000, 1_000, AHORA)).resolves.toBeDefined();
  });
});

describe('las reservas abandonadas', () => {
  /*
   * Un proceso que muera entre reservar y liquidar dejaría cupo comido hasta fin
   * de mes. Se barre en la siguiente reserva, que es cuando importa que el hueco
   * esté libre, en lugar de en un trabajo aparte que puede no llegar a tiempo.
   */
  it('la siguiente reserva libera lo que venció sin liquidarse', async () => {
    const k = clave();
    await quota.reserve(k, 900, 1_000, AHORA);
    expect((await quota.state(k, 1_000, AHORA)).reserved).toBe(900);

    /* Un cuarto de hora después, aquella reserva está abandonada. */
    const luego = AHORA + 16 * 60 * 1000;
    await expect(quota.reserve(k, 900, 1_000, luego)).resolves.toBeDefined();
    expect((await quota.state(k, 1_000, luego)).reserved).toBe(900);
  });

  it('una reserva viva no se barre por el camino', async () => {
    const k = clave();
    await quota.reserve(k, 400, 1_000, AHORA);

    await quota.reserve(k, 400, 1_000, AHORA + 60 * 1000);

    expect((await quota.state(k, 1_000, AHORA)).reserved).toBe(800);
  });
});

describe('la conciliación', () => {
  /*
   * El caso que existe para corregir: un proceso muere entre llamar al modelo y
   * liquidar. El gasto queda en la tabla y no en el contador, y nadie lo nota
   * —el cupo rinde de más— hasta que alguien cuadra el mes.
   */
  it('sube el contador hasta lo que dice el registro', async () => {
    const k = clave();
    await quota.reserve(k, 100, 10_000, AHORA);

    expect(await quota.reconcile(k, 5_000, AHORA)).toBe(5_000);
    expect((await quota.state(k, 10_000, AHORA)).spent).toBe(5_000);
  });

  /*
   * Nunca lo baja: entre leer el total y escribirlo puede haberse liquidado otra
   * invocación, y sobrescribir con el número viejo regalaría cupo ya consumido.
   */
  it('nunca lo baja, aunque el registro vaya por detrás', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 1_000, 10_000, AHORA);
    await quota.settle(k, reserva.id, 800, AHORA);

    expect(await quota.reconcile(k, 300, AHORA)).toBe(0);
    expect((await quota.state(k, 10_000, AHORA)).spent).toBe(800);
  });

  it('cuando ya cuadra, no corrige nada', async () => {
    const k = clave();
    const reserva = await quota.reserve(k, 1_000, 10_000, AHORA);
    await quota.settle(k, reserva.id, 400, AHORA);

    expect(await quota.reconcile(k, 400, AHORA)).toBe(0);
  });
});

describe('el ritmo', () => {
  /*
   * Acota el ritmo, no el volumen: para el volumen está el cupo de tokens. Son
   * cosas distintas —mil llamadas cortas y diez larguísimas no se parecen en
   * nada— y conviene no mezclarlas (RF-1206).
   */
  it('deja pasar hasta el límite y frena al siguiente', async () => {
    const ws = `ws-ritmo-${String(siguiente++)}`;

    for (let i = 0; i < 3; i += 1) {
      await expect(quota.consumeRate(ws, 'ana', 3, AHORA)).resolves.toBeUndefined();
    }

    await expect(quota.consumeRate(ws, 'ana', 3, AHORA)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('cada persona lleva su propia cuenta', async () => {
    const ws = `ws-ritmo-${String(siguiente++)}`;
    await quota.consumeRate(ws, 'ana', 1, AHORA);

    await expect(quota.consumeRate(ws, 'bruno', 1, AHORA)).resolves.toBeUndefined();
  });

  it('la hora siguiente empieza de cero', async () => {
    const ws = `ws-ritmo-${String(siguiente++)}`;
    await quota.consumeRate(ws, 'ana', 1, AHORA);
    await expect(quota.consumeRate(ws, 'ana', 1, AHORA)).rejects.toBeInstanceOf(RateLimitedError);

    await expect(quota.consumeRate(ws, 'ana', 1, AHORA + 60 * 60 * 1000)).resolves.toBeUndefined();
  });

  it('dice cuánto esperar, que es lo único que se puede hacer', async () => {
    const ws = `ws-ritmo-${String(siguiente++)}`;
    await quota.consumeRate(ws, 'ana', 1, AHORA);

    const error = (await quota
      .consumeRate(ws, 'ana', 1, AHORA)
      .catch((e: unknown) => e)) as RateLimitedError;

    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(3_600);
  });
});

describe('cuando Redis no responde', () => {
  /*
   * El riesgo que tiene guardar el techo de gasto en un almacén volátil. La
   * respuesta correcta es no invocar: con la cuota de un tercero de por medio,
   * la duda se resuelve a favor del dueño de la clave (T-31). Seguir adelante
   * sería gastar dinero ajeno sin saber si quedaba.
   */
  it('reservar no concede nada: falla', async () => {
    const muerto = new Redis({
      port: 1,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    const sinRedis = new AiQuotaService(muerto, usage);

    await expect(sinRedis.reserve(clave(), 10, 1_000, AHORA)).rejects.toBeTruthy();

    muerto.disconnect();
  });

  it('y el fallo se traduce a «no se ha invocado nada», no a un permiso', () => {
    expect(() => {
      AiQuotaService.failClosed(new Error('Redis se ha ido'));
    }).toThrow(/no se ha invocado/i);
  });

  it('pero un cupo agotado sigue siendo un cupo agotado, no una caída', () => {
    const agotado = new QuotaExceededError({ spent: 10, reserved: 0, quota: 10 });

    expect(() => {
      AiQuotaService.failClosed(agotado);
    }).toThrow(QuotaExceededError);
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
