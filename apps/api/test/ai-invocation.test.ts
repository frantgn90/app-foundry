import type { Database } from '@app-foundry/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conIdentidad } from '../src/database/con-identidad.js';
import { AiInvocationService } from '../src/ai/invocation.service.js';
import { QuotaExceededError } from '../src/ai/quota.service.js';
import { DATABASE } from '../src/infrastructure/tokens.js';
import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * El paso por el que pasa toda invocación.
 *
 * Todavía no hay ninguna ruta que llame a un modelo —eso es H10—, así que se
 * ejercita el servicio de verdad, con sus dependencias reales, dentro de una
 * transacción con identidad como la que abre cualquier petición.
 */
let h: Harness;
let ana: TestUser;
let invocaciones: AiInvocationService;
let db: Database;

const AHORA = Date.UTC(2026, 8, 15, 12, 0, 0);

const peticion = {
  system: 'eres un product owner',
  messages: [{ role: 'user' as const, content: 'revisa esto' }],
};

const comoAna = <T>(fn: () => Promise<T>): Promise<T> => conIdentidad(db, ana.id, fn);

const empezar = (
  extra: Partial<typeof peticion> & { maxOutputTokens?: number } = {},
  now = AHORA,
) =>
  comoAna(() =>
    invocaciones.begin(
      { workspaceId: ana.workspaceId, task: 'TEXT_ASSIST', userId: ana.id },
      { ...peticion, ...extra },
      now,
    ),
  );

const ponerCupo = (tokens: number | null) =>
  h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC/quota`, {
    ...(tokens === null ? {} : { monthlyTokenQuota: tokens }),
  });

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  invocaciones = h.resolve(AiInvocationService);
  db = h.resolve(DATABASE);

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
  await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
    apiKey: 'sk-de-mentira-pero-larga',
  });
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('preparar una invocación', () => {
  it('resuelve la tarea a su proveedor y su modelo', async () => {
    const empezada = await empezar();

    expect(empezada.plan.provider).toBe('ANTHROPIC');
    expect(empezada.credential.apiKey).toBe('sk-de-mentira-pero-larga');
  });

  /*
   * El techo es entrada contada más salida al máximo, no una predicción. Una
   * estimación que se quede corta deja arrancar algo que no cabe en el cupo, y
   * entonces el corte llega a mitad de una revisión ya empezada (§10).
   */
  it('estima un techo, no una media', async () => {
    const corta = await empezar({ messages: [{ role: 'user', content: 'hola' }] });
    const larga = await empezar({ messages: [{ role: 'user', content: 'hola '.repeat(500) }] });

    expect(larga.estimatedTokens).toBeGreaterThan(corta.estimatedTokens);
    expect(corta.estimatedTokens).toBeGreaterThan(corta.maxOutputTokens);
  });

  it('aparta el cupo estimado antes de llamar a nadie', async () => {
    await ponerCupo(1_000_000);
    const empezada = await empezar();

    expect(empezada.reservation.estimatedTokens).toBe(empezada.estimatedTokens);
  });
});

describe('el corte por cupo', () => {
  it('lo que no cabe en el cupo no se invoca', async () => {
    await ponerCupo(10);

    const error = await empezar().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(QuotaExceededError);
  });

  /*
   * Un corte se registra aunque no haya habido llamada. Sin él quedaría un hueco
   * en el registro y «¿por qué dejó de funcionar el martes?» no tendría
   * respuesta (RF-1201).
   */
  it('el corte queda registrado, no es un hueco', async () => {
    await ponerCupo(10);
    await empezar().catch(() => undefined);

    const filas = await h.db.execute(
      `SELECT outcome, input_tokens, output_tokens FROM ai_invocations WHERE outcome = 'QUOTA_BLOCKED'`,
    );

    expect(filas.rows.length).toBeGreaterThan(0);
    expect(filas.rows[0]).toMatchObject({ input_tokens: 0, output_tokens: 0 });
  });

  it('sin cupo fijado no hay corte', async () => {
    await ponerCupo(null);

    await expect(empezar()).resolves.toBeDefined();
  });
});

describe('el aviso de umbral', () => {
  /*
   * Otro mes, contador limpio: los bloques anteriores dejan reservas vivas a
   * propósito —no llaman a `finish`— y aquí lo que se mide es el umbral, no el
   * barrido.
   */
  const OTRO_MES = Date.UTC(2026, 10, 5, 12, 0, 0);

  /*
   * Enterarse al agotarse el cupo es enterarse tarde: para entonces la IA ya se
   * apagó y alguien se quedó a media revisión (RF-1205).
   */
  it('al pasar del umbral le llega un aviso al dueño', async () => {
    await ponerCupo(10_000);
    const empezada = await empezar({}, OTRO_MES);

    await comoAna(() =>
      invocaciones.finish(
        { workspaceId: ana.workspaceId, task: 'TEXT_ASSIST', userId: ana.id },
        empezada,
        { inputTokens: 8_500, outputTokens: 0 },
        { outcome: 'COMPLETED', now: OTRO_MES + 10 },
      ),
    );

    const avisos = (await (await h.as(ana).get('/api/v1/notifications')).json()) as {
      items: { type: string; payload: Record<string, string> }[];
    };
    const umbral = avisos.items.find((a) => a.type === 'AI_QUOTA_THRESHOLD');

    expect(umbral).toBeDefined();
    expect(umbral?.payload['provider']).toBe('ANTHROPIC');
  });

  /*
   * Uno que se repita en cada invocación a partir del 80 % deja de leerse antes
   * de llegar al 90 %.
   */
  it('solo una vez por mes y proveedor', async () => {
    /* Pequeña a propósito: lo que queda de cupo es poco y no es lo que se mide. */
    const empezada = await empezar({ maxOutputTokens: 100 }, OTRO_MES);
    await comoAna(() =>
      invocaciones.finish(
        { workspaceId: ana.workspaceId, task: 'TEXT_ASSIST', userId: ana.id },
        empezada,
        { inputTokens: 500, outputTokens: 0 },
        { outcome: 'COMPLETED', now: OTRO_MES + 10 },
      ),
    );

    const avisos = (await (await h.as(ana).get('/api/v1/notifications')).json()) as {
      items: { type: string }[];
    };

    expect(avisos.items.filter((a) => a.type === 'AI_QUOTA_THRESHOLD')).toHaveLength(1);
  });
});

describe('la página de consumo', () => {
  interface UsageBody {
    month: string;
    providers: { provider: string; quota: number | null; spentTokens: number }[];
    byTask: { key: string; inputTokens: number; outputTokens: number; invocations: number }[];
    byModel: { key: string }[];
    byMember: { key: string; inputTokens: number }[];
  }

  const consumo = (quien: TestUser) =>
    h.as(quien).get(`/api/v1/workspaces/${ana.workspaceId}/ai/usage`);

  it('desglosa el mes por tarea, por modelo y por persona', async () => {
    const body = (await (await consumo(ana)).json()) as UsageBody;

    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.byTask.some((t) => t.key === 'TEXT_ASSIST')).toBe(true);
    expect(body.byModel.length).toBeGreaterThan(0);
    expect(body.byMember.some((m) => m.key === 'ana')).toBe(true);
  });

  it('entrada y salida van separadas, y no hay ningún importe', async () => {
    const body = (await (await consumo(ana)).json()) as UsageBody;
    const tarea = body.byTask.find((t) => t.key === 'TEXT_ASSIST');

    expect(tarea?.inputTokens).toBeGreaterThan(0);
    expect(tarea).toHaveProperty('outputTokens');
    expect(JSON.stringify(body)).not.toMatch(/cost|price|usd|eur/i);
  });

  it('el dueño ve el cupo de cada proveedor frente a lo gastado', async () => {
    const body = (await (await consumo(ana)).json()) as UsageBody;

    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]).toMatchObject({ provider: 'ANTHROPIC' });
  });

  /*
   * Un miembro ve lo suyo y nada más, y eso no lo decide el servicio: lo decide
   * la política de la tabla, que no le devuelve las filas de los demás.
   */
  it('un miembro ve su consumo, no el de los demás ni el cupo', async () => {
    const bruno = await h.createUser('bruno');
    await h
      .as(ana)
      .post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

    const body = (await (await consumo(bruno)).json()) as UsageBody;

    expect(body.providers).toEqual([]);
    expect(body.byMember).toEqual([]);
  });
});

describe('cerrar una invocación', () => {
  it('liquida lo consumido de verdad y lo registra', async () => {
    await ponerCupo(1_000_000);
    const empezada = await empezar();

    await comoAna(() =>
      invocaciones.finish(
        { workspaceId: ana.workspaceId, task: 'TEXT_ASSIST', userId: ana.id },
        empezada,
        { inputTokens: 120, outputTokens: 30 },
        { outcome: 'COMPLETED', ttftMs: 40, now: AHORA + 900 },
      ),
    );

    const filas = await h.db.execute(
      `SELECT input_tokens, output_tokens, latency_ms, ttft_ms, outcome
       FROM ai_invocations WHERE outcome = 'COMPLETED' ORDER BY created_at DESC LIMIT 1`,
    );

    expect(filas.rows[0]).toMatchObject({
      input_tokens: 120,
      output_tokens: 30,
      latency_ms: 900,
      ttft_ms: 40,
    });
  });

  /*
   * Se liquida también cuando falla: lo consumido antes de fallar se consumió
   * igual, y una reserva sin liquidar deja cupo comido.
   */
  it('una invocación fallida también liquida y también se registra', async () => {
    const empezada = await empezar();

    await comoAna(() =>
      invocaciones.finish(
        { workspaceId: ana.workspaceId, task: 'TEXT_ASSIST', userId: ana.id },
        empezada,
        { inputTokens: 50, outputTokens: 0 },
        { outcome: 'FAILED', errorKind: 'TRANSIENT', now: AHORA + 100 },
      ),
    );

    const filas = await h.db.execute(
      `SELECT error_kind FROM ai_invocations WHERE outcome = 'FAILED' ORDER BY created_at DESC LIMIT 1`,
    );

    expect(filas.rows[0]).toMatchObject({ error_kind: 'TRANSIENT' });
  });

  it('lo liquidado cuenta para el siguiente', async () => {
    await ponerCupo(100_000);
    const empezada = await empezar();
    await comoAna(() =>
      invocaciones.finish(
        { workspaceId: ana.workspaceId, task: 'TEXT_ASSIST', userId: ana.id },
        empezada,
        { inputTokens: 99_000, outputTokens: 900 },
        { outcome: 'COMPLETED', now: AHORA + 10 },
      ),
    );

    await expect(empezar()).rejects.toBeInstanceOf(QuotaExceededError);
  });
});
