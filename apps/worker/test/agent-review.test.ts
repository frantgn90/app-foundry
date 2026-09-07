import { Logger } from '@nestjs/common';
import { Queue, type Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  AGENT_REVIEW_QUEUE,
  type AgentReviewJob,
  ProviderError,
  ProviderErrorKind,
  reviewCancelKey,
  type ReviewOutput,
} from '@app-foundry/core';
import { loadEnv } from '@app-foundry/env';

import { startAgentReviewWorker } from '../src/agent-review.worker.js';
import { startWorkerHarness, type WorkerHarness } from './harness.js';

/**
 * El abanico por dentro: leer, anclar y cerrar (RF-1606..1610, T-33).
 *
 * Lo que se prueba es lo que no se ve desde fuera: que cada cita acabe colgada
 * del fragmento correcto, que la que no aparece literalmente **se descarte** en
 * vez de colgarse de un sitio parecido, que cancelar pare de verdad, y que un
 * reintento no escriba dos veces lo que ya estaba escrito.
 */
const DOCUMENTO = [
  '# Gaubus',
  '',
  'Llegar al autobús con la información que de verdad hay.',
  '',
  'Los datos abiertos dan posiciones cada treinta segundos.',
].join('\n');

let h: WorkerHarness;
let worker: Worker;
let cola: Queue<AgentReviewJob>;

/** Lo que devuelve el modelo de mentira en la siguiente lectura. */
let salida: ReviewOutput = { findings: [], overall: 'Se sostiene, con reservas.' };
/** Si está puesto, la lectura falla así. */
let falloProgramado: ProviderErrorKind | null = null;
/** Lo emitido y lo repartido, para comprobar a quién le llega qué. */
let avisos: { type: string; payload: Record<string, unknown> }[] = [];
let progresos: { audiencia: readonly string[]; status: string; done: number; total: number }[] = [];

let versionId: string;

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://sin/usar',
  DATABASE_MIGRATION_URL: 'postgres://sin/usar',
  REDIS_URL: 'redis://sin/usar',
  GITHUB_CLIENT_ID: 'de-mentira',
  GITHUB_CLIENT_SECRET: 'de-mentira',
  SESSION_SECRET: 'x'.repeat(32),
});

async function aQueTermine(): Promise<void> {
  for (let intento = 0; intento < 100; intento += 1) {
    const cuentas = await cola.getJobCounts('waiting', 'active', 'delayed');
    const pendientes =
      (cuentas['waiting'] ?? 0) + (cuentas['active'] ?? 0) + (cuentas['delayed'] ?? 0);
    if (pendientes === 0) return;
    await new Promise((listo) => setTimeout(listo, 100));
  }
  throw new Error('la cola no se vació');
}

/** Una revisión recién pedida, con su ejecución para el agente del escenario. */
async function pedirRevision(): Promise<{ reviewId: string; runId: string }> {
  const [revision] = (
    await h.db.execute<{ id: string }>(
      sql`INSERT INTO agent_reviews (app_id, requested_by, version_id, estimated_tokens)
          VALUES (${h.escenario.appId}::uuid, ${h.escenario.anaId}::uuid,
                  ${versionId}::uuid, 12000)
          RETURNING id`,
    )
  ).rows;

  const [ejecucion] = (
    await h.db.execute<{ id: string }>(
      sql`INSERT INTO agent_review_runs (review_id, agent_id, idempotency_key)
          VALUES (${revision!.id}::uuid, ${h.escenario.agentId}::uuid,
                  ${`${revision!.id}:${h.escenario.agentId}`})
          RETURNING id`,
    )
  ).rows;

  return { reviewId: revision!.id, runId: ejecucion!.id };
}

async function encolar(revision: { reviewId: string; runId: string }): Promise<void> {
  await cola.add(
    'review',
    {
      reviewId: revision.reviewId,
      runId: revision.runId,
      appId: h.escenario.appId,
      agentId: h.escenario.agentId,
      actorUserId: h.escenario.anaId,
    },
    {
      jobId: `${revision.reviewId}_${h.escenario.agentId}`,
      attempts: 4,
      backoff: { type: 'custom' },
    },
  );
}

/** Los hilos que dejó esta revisión, con su cita y su primer comentario. */
async function hilosDe(reviewId: string) {
  const filas = await h.db.execute<{
    kind: string;
    anchor_quote: string | null;
    anchor_start: number | null;
    body: string;
  }>(
    sql`SELECT t.kind, t.anchor_quote, t.anchor_start, c.body
        FROM comment_threads t JOIN comments c ON c.thread_id = t.id
        WHERE t.review_id = ${reviewId}::uuid
        ORDER BY t.created_at`,
  );
  return filas.rows;
}

async function estadoDe(reviewId: string): Promise<{ review: string; run: string; hilos: number }> {
  const [fila] = (
    await h.db.execute<{ review: string; run: string; hilos: number }>(
      sql`SELECT r.status AS review, e.status AS run, e.threads_written AS hilos
          FROM agent_reviews r JOIN agent_review_runs e ON e.review_id = r.id
          WHERE r.id = ${reviewId}::uuid`,
    )
  ).rows;
  return fila!;
}

beforeAll(async () => {
  h = await startWorkerHarness();
  cola = new Queue<AgentReviewJob>(AGENT_REVIEW_QUEUE, { connection: h.redis });

  const [version] = (
    await h.db.execute<{ id: string }>(
      sql`INSERT INTO document_versions (document_id, version_no, content, author_id, message)
          SELECT d.id, 1, ${DOCUMENTO}, ${h.escenario.anaId}::uuid, 'Primera'
          FROM documents d WHERE d.app_id = ${h.escenario.appId}::uuid
          RETURNING id`,
    )
  ).rows;
  versionId = version!.id;

  worker = startAgentReviewWorker({
    redis: h.redis,
    db: h.db,
    env,
    log: new Logger('test'),
    ask: () => {
      if (falloProgramado) {
        return Promise.reject(new ProviderError(falloProgramado, 'de mentira'));
      }
      return Promise.resolve({ salida, provider: 'ANTHROPIC', modelId: 'fake-large' });
    },
    notify: (aviso) => {
      avisos.push({ type: aviso.type, payload: aviso.payload });
      return Promise.resolve([]);
    },
    progreso: (audiencia, evento) => {
      progresos.push({ audiencia, status: evento.status, done: evento.done, total: evento.total });
      return Promise.resolve();
    },
  });
}, 300_000);

afterEach(() => {
  avisos = [];
  progresos = [];
  falloProgramado = null;
  salida = { findings: [], overall: 'Se sostiene, con reservas.' };
});

afterAll(async () => {
  await worker.close();
  await cola.close();
  await h.stop();
});

describe('un agente revisa el documento', () => {
  it('deja un hilo por cita, anclado a su sitio, y uno general', async () => {
    salida = {
      findings: [
        {
          quote: 'Los datos abiertos dan posiciones cada treinta segundos',
          comment: '¿Y cuando el operador corta la API?',
        },
      ],
      overall: 'La idea se sostiene; el riesgo de plataforma no.',
    };

    const revision = await pedirRevision();
    await encolar(revision);
    await aQueTermine();

    const hilos = await hilosDe(revision.reviewId);
    expect(hilos).toHaveLength(2);

    const inline = hilos.find((t) => t.kind === 'INLINE')!;
    expect(inline.anchor_quote).toBe('Los datos abiertos dan posiciones cada treinta segundos');
    /* Anclado donde está de verdad, no al principio del documento (RF-808). */
    expect(inline.anchor_start).toBe(DOCUMENTO.indexOf('Los datos abiertos'));
    expect(inline.body).toContain('corta la API');

    const general = hilos.find((t) => t.kind === 'GENERAL')!;
    expect(general.body).toContain('se sostiene');

    const estado = await estadoDe(revision.reviewId);
    expect(estado).toEqual({ review: 'DONE', run: 'DONE', hilos: 2 });
  });

  it('y avisa una vez, con cuántos comentarios dejó', async () => {
    /*
     * Uno por agente y no uno por comentario: cinco agentes con cinco hilos
     * cada uno dejarían veinticinco avisos y la campana inservible.
     */
    salida = { findings: [], overall: 'Poco que añadir.' };

    const revision = await pedirRevision();
    await encolar(revision);
    await aQueTermine();

    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]!.payload['excerpt'])).toContain('1 comments');
  });

  it('una cita que no está en el documento se descarta en vez de colgarse mal', async () => {
    /*
     * Un modelo que cita «casi» igual es lo normal. Anclar por aproximación
     * pondría el comentario en un fragmento parecido sin que quien lo lee pueda
     * saberlo, así que se pierde a propósito (D-13).
     */
    salida = {
      findings: [
        { quote: 'Los datos abiertos dan posiciones cada 30 segundos', comment: 'Casi igual' },
        { quote: 'Llegar al autobús', comment: 'Esta sí está' },
      ],
      overall: '',
    };

    const revision = await pedirRevision();
    await encolar(revision);
    await aQueTermine();

    const hilos = await hilosDe(revision.reviewId);
    expect(hilos).toHaveLength(1);
    expect(hilos[0]!.anchor_quote).toBe('Llegar al autobús');
  });

  it('el progreso se reparte a quien ve la app, al empezar y al acabar', async () => {
    const revision = await pedirRevision();
    await encolar(revision);
    await aQueTermine();

    expect(progresos.length).toBeGreaterThanOrEqual(2);
    expect(progresos[0]!.status).toBe('RUNNING');
    expect(progresos.at(-1)).toMatchObject({ status: 'DONE', done: 1, total: 1 });
    expect(progresos.at(-1)!.audiencia).toContain(h.escenario.anaId);
  });
});

describe('cancelar', () => {
  it('lo que no ha empezado no empieza, y no se llama al modelo', async () => {
    const revision = await pedirRevision();
    await h.redis.set(reviewCancelKey(revision.reviewId), '1');

    salida = {
      findings: [{ quote: 'Llegar al autobús', comment: 'No debería escribirse' }],
      overall: 'Tampoco esto',
    };

    await encolar(revision);
    await aQueTermine();

    expect(await hilosDe(revision.reviewId)).toHaveLength(0);
    expect((await estadoDe(revision.reviewId)).run).toBe('CANCELLED');

    await h.redis.del(reviewCancelKey(revision.reviewId));
  });
});

describe('un reintento no escribe dos veces', () => {
  it('la ejecución terminada no se repite', async () => {
    /*
     * Es la idempotencia de T-33: la ejecución escribe sus hilos y su cambio de
     * estado en la misma transacción, así que quien llega después la encuentra
     * cerrada y no repite nada.
     */
    salida = {
      findings: [{ quote: 'Llegar al autobús', comment: 'Una vez' }],
      overall: 'Una sola vez',
    };

    const revision = await pedirRevision();
    await encolar(revision);
    await aQueTermine();
    const primera = await hilosDe(revision.reviewId);

    /* Se encola otra vez con otro identificador, como haría un reintento. */
    await cola.add(
      'review',
      {
        reviewId: revision.reviewId,
        runId: revision.runId,
        appId: h.escenario.appId,
        agentId: h.escenario.agentId,
        actorUserId: h.escenario.anaId,
      },
      { attempts: 1 },
    );
    await aQueTermine();

    expect(await hilosDe(revision.reviewId)).toHaveLength(primera.length);
  });
});

describe('cuando el proveedor falla del todo', () => {
  it('la ejecución queda fallida, la revisión también, y se avisa a quien la pidió', async () => {
    falloProgramado = ProviderErrorKind.AUTH;

    const revision = await pedirRevision();
    await encolar(revision);
    await aQueTermine();

    /* El aviso llega desde el manejador de `failed`, después de la cola. */
    for (let intento = 0; intento < 30 && avisos.length === 0; intento += 1) {
      await new Promise((listo) => setTimeout(listo, 100));
    }

    const estado = await estadoDe(revision.reviewId);
    expect(estado.run).toBe('FAILED');
    expect(estado.review).toBe('FAILED');

    const fallo = avisos.find((a) => a.type === 'AI_AGENT_FAILED');
    expect(fallo).toBeDefined();
    expect(String(fallo!.payload['message'])).toContain('credential');
  });
});
