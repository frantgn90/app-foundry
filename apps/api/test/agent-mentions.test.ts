import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * A quién invoca una mención, y a quién no.
 *
 * Mencionar a una persona **avisa** y mencionar a un agente **invoca**: son dos
 * tablas porque son dos comportamientos, y aquí se comprueba que cada `@algo`
 * acabe en la que le toca.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let appId: string;
let hilo: string;
let elPO: string;

interface Comentario {
  id: string;
  body: string;
  authorKind: string;
  authorHandle: string;
  authorIconEmoji: string | null;
  authorRetired: boolean;
  isMine: boolean;
}

/** Las menciones de agente registradas para un comentario. */
async function invocados(commentId: string): Promise<string[]> {
  const filas = await h.db.execute<{ agent_id: string }>(
    sql`SELECT agent_id FROM comment_agent_mentions WHERE comment_id = ${commentId}::uuid`,
  );
  return filas.rows.map((f) => f.agent_id);
}

async function comentar(quien: TestUser, body: string): Promise<Comentario> {
  const res = await h.as(quien).post(`/api/v1/threads/${hilo}/comments`, { body });
  expect(res.status).toBe(201);
  return (await res.json()) as Comentario;
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
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Abro hilo.' })
  ).json()) as { id: string };
  hilo = creado.id;
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('mencionar a un agente lo invoca', () => {
  it('queda registrado, y el agente es el de esta app', async () => {
    const comentario = await comentar(ana, '@po ¿esto se sostiene?');
    expect(await invocados(comentario.id)).toEqual([elPO]);
  });

  it('mencionar a una persona no invoca a nadie: avisa, que es otra cosa', async () => {
    const comentario = await comentar(ana, '@bruno ¿tú qué ves?');
    expect(await invocados(comentario.id)).toEqual([]);
  });

  it('las dos a la vez van cada una a su tabla', async () => {
    const comentario = await comentar(ana, '@bruno mira lo que dice @po');
    expect(await invocados(comentario.id)).toEqual([elPO]);
    expect(comentario.body).toContain('@po');
  });

  it('un handle que no es de nadie no registra nada, y no falla', async () => {
    const comentario = await comentar(ana, '@nadie ¿estás?');
    expect(await invocados(comentario.id)).toEqual([]);
  });

  it('editar el comentario recalcula a quién invoca', async () => {
    const comentario = await comentar(ana, 'Sin llamar a nadie.');
    expect(await invocados(comentario.id)).toEqual([]);

    await h.as(ana).patch(`/api/v1/comments/${comentario.id}`, { body: 'Ahora sí, @po' });
    expect(await invocados(comentario.id)).toEqual([elPO]);
  });
});

describe('un agente que no interviene no se invoca', () => {
  it('desactivado, no se registra la mención', async () => {
    await h.as(ana).patch(`/api/v1/apps/${appId}/agents/${elPO}`, { active: false });

    const comentario = await comentar(ana, '@po ¿sigues ahí?');
    expect(await invocados(comentario.id)).toEqual([]);

    await h.as(ana).patch(`/api/v1/apps/${appId}/agents/${elPO}`, { active: true });
  });

  it('retirado, tampoco', async () => {
    const otro = (await (
      await h.as(ana).post(`/api/v1/apps/${appId}/agents`, {
        templateId: (
          (await (
            await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/agent-templates`)
          ).json()) as { id: string }[]
        )[0]!.id,
        handle: 'efimero',
      })
    ).json()) as { id: string };

    await h.as(ana).delete(`/api/v1/apps/${appId}/agents/${otro.id}`);

    const comentario = await comentar(ana, '@efimero ¿y tú?');
    expect(await invocados(comentario.id)).toEqual([]);
  });
});

describe('leer un comentario de agente', () => {
  it('se distingue de uno de persona sin tener que deducirlo', async () => {
    /*
     * Se escribe por la puerta de la base de datos, que es la única que hay
     * hasta que el worker exista. Lo que se comprueba aquí es la **lectura**:
     * antes, un comentario de agente no aparecía siquiera en la lista, porque la
     * consulta exigía persona con un `innerJoin`.
     */
    const revision = await h.db.execute<{ id: string }>(
      sql`SELECT id FROM agent_prompt_revisions WHERE agent_id = ${elPO}::uuid ORDER BY revision DESC LIMIT 1`,
    );

    await h.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${ana.id}, true)`);
      await tx.execute(
        sql`SELECT agent_write_comment(
              cast(${hilo} as uuid),
              cast(${elPO} as uuid),
              cast(${revision.rows[0]!.id} as uuid),
              'Scope looks wider than the problem.')`,
      );
    });

    const hilos = (await (await h.as(ana).get(`/api/v1/apps/${appId}/threads`)).json()) as {
      threads: { id: string; comments: Comentario[] }[];
    };

    const suyo = hilos.threads
      .find((t) => t.id === hilo)!
      .comments.find((c) => c.authorKind === 'AGENT');

    expect(suyo).toBeDefined();
    expect(suyo!.body).toBe('Scope looks wider than the problem.');
    expect(suyo!.authorHandle).toBe('po');
    expect(suyo!.authorIconEmoji).toBe('🎯');
    expect(suyo!.authorRetired).toBe(false);
    /* Nunca es de quien mira: un agente no tiene sesión. */
    expect(suyo!.isMine).toBe(false);
  });
});
