import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';

import { AGENT_REPLY_QUEUE, AgentTrigger } from '@app-foundry/core';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * A quién se despierta cuando alguien escribe.
 *
 * Se mira la cola de verdad, no un doble: lo que hay que comprobar es qué llega
 * a Redis y con qué clave, y un doble comprobaría que la función se llamó.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let appId: string;
let hilo: string;
let elPO: string;
let elTechLead: string;
let redis: Redis;
let cola: Queue;

/** Los trabajos que esperan en la cola, del primero al último. */
async function encolados(): Promise<{ id: string; trigger: string; agentId: string }[]> {
  const trabajos = await cola.getJobs(['waiting', 'delayed', 'active', 'prioritized']);
  return trabajos
    .map((t) => ({
      id: String(t.id),
      trigger: String(t.name),
      agentId: (t.data as { agentId: string }).agentId,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function vaciar(): Promise<void> {
  await cola.drain();
  await cola.clean(0, 1_000, 'completed');
  await cola.clean(0, 1_000, 'failed');
}

async function comentar(quien: TestUser, body: string): Promise<string> {
  const res = await h.as(quien).post(`/api/v1/threads/${hilo}/comments`, { body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Le hace escribir a un agente, que es la única forma de que «ya participe». */
async function hacerHablar(agentId: string, texto: string): Promise<void> {
  const revision = await h.db.execute<{ id: string }>(
    sql`SELECT id FROM agent_prompt_revisions WHERE agent_id = ${agentId}::uuid ORDER BY revision DESC LIMIT 1`,
  );
  await h.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${ana.id}, true)`);
    await tx.execute(
      sql`SELECT agent_write_comment(
            cast(${hilo} as uuid),
            cast(${agentId} as uuid),
            cast(${revision.rows[0]!.id} as uuid),
            ${texto})`,
    );
  });
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

  const app = (await (
    await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
      name: 'Con agentes',
      accessLevel: 'WORKSPACE_WRITE',
    })
  ).json()) as { id: string };
  appId = app.id;

  for (const key of ['product-owner', 'tech-lead']) {
    await h
      .as(ana)
      .post(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/catalog/${key}`, {});
  }
  const plantillas = (await (
    await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/agent-templates`)
  ).json()) as { id: string; handle: string }[];

  for (const plantilla of plantillas) {
    const creado = (await (
      await h.as(ana).post(`/api/v1/apps/${appId}/agents`, { templateId: plantilla.id })
    ).json()) as { id: string; handle: string };
    if (creado.handle === 'po') elPO = creado.id;
    if (creado.handle === 'techlead') elTechLead = creado.id;
  }

  const creado = (await (
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Abro hilo.' })
  ).json()) as { id: string };
  hilo = creado.id;

  redis = new Redis(h.redisUrl, { maxRetriesPerRequest: null });
  cola = new Queue(AGENT_REPLY_QUEUE, { connection: redis });
}, 240_000);

afterAll(async () => {
  await cola.close();
  redis.disconnect();
  await h.stop();
});

describe('la mención despierta', () => {
  it('encola una respuesta para el agente mencionado', async () => {
    await vaciar();
    const commentId = await comentar(ana, '@po ¿esto se sostiene?');

    const trabajos = await encolados();
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]!.agentId).toBe(elPO);
    expect(trabajos[0]!.trigger).toBe(AgentTrigger.MENTION);
    /* La clave lleva comentario y agente: es lo que hace idempotente al reintento. */
    expect(trabajos[0]!.id).toBe(`${commentId}_${elPO}`);
  });

  it('a dos, si se menciona a dos', async () => {
    await vaciar();
    await comentar(ana, '@po y @techlead, ¿qué veis?');

    const trabajos = await encolados();
    expect(trabajos.map((t) => t.agentId).sort()).toEqual([elPO, elTechLead].sort());
  });

  it('mencionar solo a una persona no despierta a nadie', async () => {
    await vaciar();
    await comentar(ana, '@bruno ¿tú qué opinas?');

    expect(await encolados()).toHaveLength(0);
  });

  it('un comentario sin menciones tampoco, mientras no haya hablado ningún agente', async () => {
    await vaciar();
    await comentar(ana, 'Una idea suelta.');

    expect(await encolados()).toHaveLength(0);
  });
});

describe('responder donde un agente ya escribió lo despierta', () => {
  beforeAll(async () => {
    await hacerHablar(elPO, 'Scope looks wider than the problem.');
  });

  it('sin mencionarlo, y marcado como réplica y no como mención', async () => {
    await vaciar();
    await comentar(bruno, 'Buen punto, lo acoto.');

    const trabajos = await encolados();
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]!.agentId).toBe(elPO);
    expect(trabajos[0]!.trigger).toBe(AgentTrigger.REPLY);
  });

  it('el que no ha escrito aquí sigue callado', async () => {
    await vaciar();
    await comentar(ana, 'Otra vuelta.');

    const trabajos = await encolados();
    expect(trabajos.map((t) => t.agentId)).not.toContain(elTechLead);
  });

  it('mencionarlo manda una sola vez, y como mención', async () => {
    /*
     * Importa cuál de los dos gana: una mención levanta el tope de turnos y una
     * réplica no (RF-1605). Encolar las dos dejaría al azar cuál se ejecuta.
     */
    await vaciar();
    await comentar(ana, '@po otra vez');

    const trabajos = await encolados();
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]!.trigger).toBe(AgentTrigger.MENTION);
  });

  it('un agente desactivado no vuelve porque alguien siga hablando', async () => {
    await h.as(ana).patch(`/api/v1/apps/${appId}/agents/${elPO}`, { active: false });

    await vaciar();
    await comentar(ana, 'Sigo yo sola.');
    expect(await encolados()).toHaveLength(0);

    await h.as(ana).patch(`/api/v1/apps/${appId}/agents/${elPO}`, { active: true });
  });
});

describe('lo que escribe un agente no despierta a nadie', () => {
  it('ni siquiera si su texto menciona a otro agente', async () => {
    await vaciar();
    /*
     * Es el cortafuegos de RF-1604 por su lado estructural: el agente escribe
     * por la función del motor, que no pasa por el productor, y su mención no
     * llega a registrarse. Sin fila no hay a quién despertar.
     */
    await hacerHablar(elTechLead, 'Estoy de acuerdo con @po en el alcance.');

    expect(await encolados()).toHaveLength(0);
  });
});
