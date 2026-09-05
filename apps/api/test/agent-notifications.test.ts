import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotificationEmitter } from '@app-foundry/notifications';
import { conIdentidad } from '@app-foundry/platform';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Quién se entera de lo que escribe un agente, y quién ha pedido no enterarse.
 *
 * Lo que escribe el agente lo escribe el worker, que es otro proceso. Aquí se
 * ejercita el **emisor** con los mismos datos que le pasa el worker, que es lo
 * que decide la audiencia; que el worker lo llame se comprueba arrancándolo.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let appId: string;
let hilo: string;
let elPO: string;

interface Aviso {
  type: string;
  payload: Record<string, unknown>;
}

async function avisosDe(quien: TestUser): Promise<Aviso[]> {
  const res = await h.as(quien).get('/api/v1/notifications');
  const cuerpo = (await res.json()) as { items: Aviso[] };
  return cuerpo.items;
}

/**
 * Cuántos avisos de respuesta tiene ya.
 *
 * Se cuenta y no se mira si «hay alguno»: la lista devuelve también los leídos,
 * así que después del primer bloque siempre habría uno y la comprobación de que
 * silenciar funciona pasaría sola.
 */
async function cuantosAvisos(quien: TestUser): Promise<number> {
  return (await avisosDe(quien)).filter((a) => a.type === 'THREAD_REPLIED').length;
}

/**
 * Lo mismo que hace el worker al terminar: escribe el comentario por la puerta
 * del motor y emite el aviso con la audiencia ya calculada.
 */
async function elAgenteContesta(texto: string): Promise<void> {
  const revision = await h.db.execute<{ id: string }>(
    sql`SELECT id FROM agent_prompt_revisions WHERE agent_id = ${elPO}::uuid ORDER BY revision DESC LIMIT 1`,
  );
  const emisor = h.resolve(NotificationEmitter);

  await conIdentidad(h.db, ana.id, async () => {
    const { currentTx } = await import('@app-foundry/platform');
    await currentTx().execute(
      sql`SELECT agent_write_comment(
            cast(${hilo} as uuid),
            cast(${elPO} as uuid),
            cast(${revision.rows[0]!.id} as uuid),
            cast(${texto} as text))`,
    );

    const participantes = await currentTx().execute<{ user_id: string }>(
      sql`SELECT DISTINCT author_id AS user_id FROM comments
          WHERE thread_id = ${hilo}::uuid AND author_id IS NOT NULL`,
    );
    const callados = await currentTx().execute<{ user_id: string }>(
      sql`SELECT user_id FROM notification_agent_muted_by(cast(${elPO} as uuid))`,
    );

    await emisor.emit({
      type: 'THREAD_REPLIED',
      entorno: {
        actor: '',
        autorDelHilo: ana.id,
        participantesDelHilo: participantes.rows.map((f) => f.user_id),
      },
      workspaceId: ana.workspaceId,
      appId,
      threadId: hilo,
      payload: { actorHandle: 'po', appName: 'Con agentes', excerpt: texto, byAgent: true },
      silenciados: callados.rows.map((f) => f.user_id),
    });
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

  const plantilla = (await (
    await h
      .as(ana)
      .post(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/catalog/product-owner`, {})
  ).json()) as { id: string };

  const agente = (await (
    await h.as(ana).post(`/api/v1/apps/${appId}/agents`, { templateId: plantilla.id })
  ).json()) as { id: string };
  elPO = agente.id;

  const creado = (await (
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Abro hilo, @po.' })
  ).json()) as { id: string };
  hilo = creado.id;

  /* Bruno también participa, así que entra en la audiencia del hilo. */
  await h.as(bruno).post(`/api/v1/threads/${hilo}/comments`, { body: 'Yo también miro.' });
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('cuando contesta un agente', () => {
  beforeAll(async () => {
    await elAgenteContesta('Scope looks wider than the problem.');
  });

  it('avisa a quien lo llamó, al revés que cuando actúa una persona', async () => {
    /*
     * Con una persona, quien actúa no recibe aviso de lo suyo (RF-905). Aquí
     * quien llamó al agente es justamente a quien más le interesa saber que ha
     * contestado, y el actor del aviso es el agente, que no está en ninguna
     * lista.
     */
    const suyos = await avisosDe(ana);
    expect(suyos.some((a) => a.type === 'THREAD_REPLIED')).toBe(true);
  });

  it('y al resto de personas del hilo', async () => {
    const suyos = await avisosDe(bruno);
    expect(suyos.some((a) => a.type === 'THREAD_REPLIED')).toBe(true);
  });

  it('el aviso dice que lo escribió una IA, sin tener que deducirlo', async () => {
    const suyos = await avisosDe(ana);
    const elDelAgente = suyos.find((a) => a.type === 'THREAD_REPLIED');
    expect(elDelAgente!.payload['byAgent']).toBe(true);
    expect(elDelAgente!.payload['actorHandle']).toBe('po');
  });

  it('el agente no recibe nada: no tiene bandeja ni sesión', async () => {
    const filas = await h.db.execute<{ cuantos: number }>(
      sql`SELECT count(*)::int AS cuantos FROM notifications n
          WHERE n.user_id IN (SELECT id FROM users WHERE handle = 'po')`,
    );
    expect(filas.rows[0]!.cuantos).toBe(0);
  });
});

describe('silenciar a un agente', () => {
  const silenciar = (quien: TestUser) =>
    h.as(quien).put(`/api/v1/apps/${appId}/agents/${elPO}/mute`);
  const volverAOir = (quien: TestUser) =>
    h.as(quien).delete(`/api/v1/apps/${appId}/agents/${elPO}/mute`);

  it('deja de avisar a quien lo silenció, y solo a él', async () => {
    expect((await silenciar(bruno)).status).toBe(204);

    const brunoAntes = await cuantosAvisos(bruno);
    const anaAntes = await cuantosAvisos(ana);

    await elAgenteContesta('And who would say no to it.');

    expect(await cuantosAvisos(bruno)).toBe(brunoAntes);
    expect(await cuantosAvisos(ana)).toBe(anaAntes + 1);
  });

  it('pero el comentario sigue ahí: se silencia el aviso, no la voz', async () => {
    const hilos = (await (await h.as(bruno).get(`/api/v1/apps/${appId}/threads`)).json()) as {
      threads: { id: string; comments: { body: string }[] }[];
    };

    const suyo = hilos.threads.find((t) => t.id === hilo)!;
    expect(suyo.comments.some((c) => c.body === 'And who would say no to it.')).toBe(true);
  });

  it('se ve a quién ha silenciado uno, y no a quién han silenciado los demás', async () => {
    expect(await (await h.as(bruno).get(`/api/v1/apps/${appId}/agents/muted`)).json()).toEqual([
      elPO,
    ]);
    expect(await (await h.as(ana).get(`/api/v1/apps/${appId}/agents/muted`)).json()).toEqual([]);
  });

  it('volver a oírlo lo deshace', async () => {
    expect((await volverAOir(bruno)).status).toBe(204);

    const antes = await cuantosAvisos(bruno);
    await elAgenteContesta('One more thing.');

    expect(await cuantosAvisos(bruno)).toBe(antes + 1);
  });
});
