import type { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ProviderError, ProviderErrorKind } from '@app-foundry/core';
import { loadEnv } from '@app-foundry/env';

import { startAgentReplyWorker } from '../src/agent-reply.worker.js';
import { startWorkerHarness, type WorkerHarness } from './harness.js';

/**
 * Los cortafuegos del worker, ejecutados (RNF-902).
 *
 * Es la suite que exige el requisito: que un agente no reaccione a otro, que su
 * mención no invoque, y que el tope de turnos se respete. Se comprueban aquí y
 * no más arriba porque el worker es quien decide, y lo decide **al ejecutar**:
 * entre encolar y contestar puede haber pasado cualquier cosa.
 *
 * El modelo y los avisos se inyectan, que es para lo que están: lo que se
 * prueba es quién habla y cuándo, no qué contesta.
 */
let h: WorkerHarness;
let worker: Worker;

/** Lo que le pediríamos al modelo, y cuántas veces. */
let peticiones: { agentId: string; system: string; material: string }[] = [];
/** Los avisos emitidos, para comprobar que se avisa una vez y a quién. */
let avisos: unknown[] = [];
/** Si está puesto, la siguiente llamada al modelo falla así. */
let falloProgramado: { kind: ProviderErrorKind; veces: number } | null = null;
/** Lo que devuelve el modelo de mentira. Cambiarlo prueba qué se guarda. */
let respuesta = 'Scope looks wider than the problem.';

/*
 * El entorno se compone con lo mínimo que el esquema exige. No se lee el `.env`
 * de la máquina a propósito: apuntaría a la base de datos de desarrollo y estas
 * pruebas escriben.
 */
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://sin/usar',
  DATABASE_MIGRATION_URL: 'postgres://sin/usar',
  REDIS_URL: 'redis://sin/usar',
  GITHUB_CLIENT_ID: 'de-mentira',
  GITHUB_CLIENT_SECRET: 'de-mentira',
  SESSION_SECRET: 'x'.repeat(32),
});

/** Espera a que la cola se quede sin trabajo pendiente ni en curso. */
async function aQueTermine(): Promise<void> {
  for (let intento = 0; intento < 100; intento += 1) {
    const cuentas = await h.cola.getJobCounts('waiting', 'active', 'delayed');
    const pendientes =
      (cuentas['waiting'] ?? 0) + (cuentas['active'] ?? 0) + (cuentas['delayed'] ?? 0);
    if (pendientes === 0) return;
    await new Promise((listo) => setTimeout(listo, 100));
  }
  throw new Error('la cola no se vació');
}

beforeAll(async () => {
  h = await startWorkerHarness();

  worker = startAgentReplyWorker({
    redis: h.redis,
    db: h.db,
    env,
    log: new Logger('test'),
    ask: (peticion) => {
      peticiones.push({
        agentId: peticion.agentId,
        system: peticion.system,
        material: peticion.messages.map((m) => m.content).join('\n'),
      });

      if (falloProgramado && falloProgramado.veces > 0) {
        falloProgramado.veces -= 1;
        return Promise.reject(new ProviderError(falloProgramado.kind, 'de mentira'));
      }
      return Promise.resolve({
        texto: respuesta,
        razonamiento: '',
        provider: 'ANTHROPIC',
        modelId: 'fake-large',
      });
    },
    notify: (aviso) => {
      avisos.push(aviso);
      return Promise.resolve([]);
    },
  });
}, 300_000);

afterEach(() => {
  peticiones = [];
  avisos = [];
  falloProgramado = null;
  respuesta = 'Scope looks wider than the problem.';
});

afterAll(async () => {
  await worker.close();
  await h.stop();
});

describe('un agente contesta a quien le habla', () => {
  it('escribe una vez, colgando del comentario que lo provocó', async () => {
    const provocador = await h.comentar('@po ¿esto se sostiene?');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(1);
    expect(await h.loEscritoPorElAgente()).toEqual(['Scope looks wider than the problem.']);
    expect(avisos).toHaveLength(1);
  });

  it('y el perfil viaja aparte del material, que va etiquetado como datos', async () => {
    const provocador = await h.comentar('@po otra vez');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones[0]!.system).toContain('Ask what problem this solves.');
    expect(peticiones[0]!.system).toContain('DATA');
    /* Y el hilo va en el otro lado, nunca en el papel (RF-1614). */
    expect(peticiones[0]!.system).not.toContain('¿esto se sostiene?');
    expect(peticiones[0]!.material).toContain('<thread>');
  });
});

describe('el cortafuegos: un agente no reacciona a otro', () => {
  it('un trabajo cuyo disparador escribió un agente no llega al modelo', async () => {
    /*
     * Se encola a mano contra un comentario del propio agente, que es lo que no
     * puede ocurrir por el camino normal: la condición de entrada es que lo
     * haya escrito una persona (T-35). Se comprueba aquí porque es la
     * comprobación que sigue en pie si algún día se encola desde otro sitio.
     */
    const [suyo] = (
      await h.db.execute<{ id: string }>(
        sql`SELECT id FROM comments
            WHERE thread_id = ${h.escenario.threadId}::uuid AND author_agent_id IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows;

    await h.encolar({ triggerCommentId: suyo!.id });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);
  });
});

describe('el cortafuegos: el tope de turnos por hilo', () => {
  it('al alcanzarlo, una réplica ya no le hace hablar', async () => {
    /* Ya ha escrito dos veces; la tercera agota el tope de tres. */
    const tercero = await h.comentar('Sigo hablando.');
    await h.encolar({ triggerCommentId: tercero, trigger: 'REPLY' });
    await aQueTermine();
    expect(peticiones).toHaveLength(1);

    peticiones = [];
    const cuarto = await h.comentar('Y una vez más.');
    await h.encolar({ triggerCommentId: cuarto, trigger: 'REPLY' });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);
  });

  it('pero una mención explícita le devuelve la palabra', async () => {
    /*
     * El tope existe para que un hilo no se llene solo, no para dejar mudo a
     * quien alguien está llamando a propósito (RF-1605).
     */
    const llamada = await h.comentar('@po te llamo aunque hayas hablado mucho');
    await h.encolar({ triggerCommentId: llamada, trigger: 'MENTION' });
    await aQueTermine();

    expect(peticiones).toHaveLength(1);
  });
});

describe('un agente que ya no interviene', () => {
  it('desactivado, no contesta aunque el trabajo estuviera encolado', async () => {
    await h.db.execute(
      sql`UPDATE agents SET active = false WHERE id = ${h.escenario.agentId}::uuid`,
    );

    const provocador = await h.comentar('@po ¿sigues?');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);

    await h.db.execute(
      sql`UPDATE agents SET active = true WHERE id = ${h.escenario.agentId}::uuid`,
    );
  });
});

describe('un reintento no duplica el comentario', () => {
  it('el mismo disparador no se contesta dos veces', async () => {
    const provocador = await h.comentar('@po una sola respuesta');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();
    const trasElPrimero = (await h.loEscritoPorElAgente()).length;

    /* Como si el trabajo se hubiera reencolado tras una caída. */
    peticiones = [];
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);
    expect((await h.loEscritoPorElAgente()).length).toBe(trasElPrimero);
  });
});

describe('qué se reintenta y qué no', () => {
  it('un fallo pasajero se reintenta y acaba contestando', async () => {
    falloProgramado = { kind: ProviderErrorKind.TRANSIENT, veces: 1 };

    const provocador = await h.comentar('@po con un tropiezo');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    /* Dos llamadas: la que falló y la que salió (RNF-703). */
    expect(peticiones.length).toBeGreaterThanOrEqual(2);
    expect(await h.loEscritoPorElAgente()).toContain('Scope looks wider than the problem.');
  });

  it('una credencial revocada no se reintenta: insistir solo acumula fallos', async () => {
    falloProgramado = { kind: ProviderErrorKind.AUTH, veces: 99 };

    const provocador = await h.comentar('@po con la clave mal');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(1);
  });
});
