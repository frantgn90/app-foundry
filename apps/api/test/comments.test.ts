import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let appId: string;
let fragmento: string;

interface Thread {
  id: string;
  kind: string;
  status: string;
  anchorStatus: string | null;
  anchorQuote: string | null;
  anchorStart: number | null;
  canDelete: boolean;
  comments: { id: string; body: string; isDeleted: boolean; mentions: string[] }[];
}

async function documento() {
  const response = await h.as(ana).get(`/api/v1/apps/${appId}/document`);
  return (await response.json()) as { content: string; currentVersionId: string };
}

async function hilos(user: TestUser = ana): Promise<Thread[]> {
  return (await (await h.as(user).get(`/api/v1/apps/${appId}/threads`)).json()) as Thread[];
}

/** Guarda una versión nueva con el contenido dado. */
async function guardar(content: string) {
  const doc = await documento();
  return h.as(ana).put(`/api/v1/apps/${appId}/document`, {
    content,
    baseVersionId: doc.currentVersionId,
  });
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

  const created = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
    name: 'Comentada',
    accessLevel: 'WORKSPACE_READ',
  });
  appId = ((await created.json()) as { id: string }).id;

  // Un documento propio, más fácil de manipular que la plantilla.
  await guardar('# The problem\n\nDeciding what to build is guesswork.\n\n# Who\n\nSmall teams.\n');
  fragmento = 'Deciding what to build is guesswork';
});

afterAll(async () => {
  await h?.stop();
});

describe('hilo general', () => {
  it('quien solo puede leer la app puede abrir un hilo (RF-803)', async () => {
    const doc = await h.as(bruno).get(`/api/v1/apps/${appId}/document`);
    const { canEdit } = (await doc.json()) as { canEdit: boolean };
    expect(canEdit).toBe(false);

    const response = await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Una pregunta sobre esto',
    });
    expect(response.status).toBe(201);

    const thread = (await response.json()) as Thread;
    expect(thread.kind).toBe('GENERAL');
    expect(thread.comments).toHaveLength(1);
  });

  it('las respuestas se anidan un solo nivel', async () => {
    const [thread] = await hilos();
    const primera = await h
      .as(ana)
      .post(`/api/v1/threads/${thread!.id}/comments`, { body: 'Respondo' });
    const raiz = (await primera.json()) as { id: string };

    const segunda = await h.as(bruno).post(`/api/v1/threads/${thread!.id}/comments`, {
      body: 'Respondo a la respuesta',
      parentId: raiz.id,
    });
    expect(segunda.status).toBe(201);

    // Un tercer nivel lo rechaza la base de datos, no la interfaz.
    const respuesta = (await segunda.json()) as { id: string };
    const tercera = await h.as(ana).post(`/api/v1/threads/${thread!.id}/comments`, {
      body: 'Y otro nivel más',
      parentId: respuesta.id,
    });
    expect(tercera.status).toBe(409);
  });
});

describe('hilos anclados al texto', () => {
  it('se ancla a un fragmento y guarda su cita', async () => {
    const doc = await documento();
    const start = doc.content.indexOf(fragmento);

    const response = await h.as(ana).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Esto es lo importante',
      quote: fragmento,
      start,
      end: start + fragmento.length,
    });
    expect(response.status).toBe(201);

    const thread = (await response.json()) as Thread;
    expect(thread.kind).toBe('INLINE');
    expect(thread.anchorStatus).toBe('ANCHORED');
    expect(thread.anchorQuote).toBe(fragmento);
  });

  it('un fragmento que no coincide con el documento se rechaza', async () => {
    const response = await h.as(ana).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Sobre algo que no está',
      quote: 'un texto que no existe en el documento',
      start: 0,
      end: 38,
    });
    // Si el cliente y el servidor no miran el mismo texto, anclar sería
    // inventarse una posición.
    expect(response.status).toBe(403);
  });

  it('editar el documento recoloca el ancla', async () => {
    const doc = await documento();
    await guardar(`# Context\n\nA new paragraph on top.\n\n${doc.content}`);

    const inline = (await hilos()).find((t) => t.kind === 'INLINE');
    expect(inline?.anchorStatus).toBe('ANCHORED');
    // Se ha desplazado hacia abajo, pero sigue sobre su fragmento.
    const actual = await documento();
    expect(
      actual.content.slice(inline!.anchorStart!, inline!.anchorStart! + fragmento.length),
    ).toBe(fragmento);
  });

  it('reescribir el fragmento lo deja huérfano, conservando su cita (RF-809)', async () => {
    const doc = await documento();
    await guardar(doc.content.replace(fragmento, 'Choosing what to build is mostly intuition'));

    const inline = (await hilos()).find((t) => t.kind === 'INLINE');
    expect(inline?.anchorStatus).toBe('ORPHANED');
    expect(inline?.anchorStart).toBeNull();
    // La cita permanece: es lo que permite mostrar de qué hablaba.
    expect(inline?.anchorQuote).toBe(fragmento);
  });

  it('y revive si el texto vuelve', async () => {
    const doc = await documento();
    await guardar(doc.content.replace('Choosing what to build is mostly intuition', fragmento));

    const inline = (await hilos()).find((t) => t.kind === 'INLINE');
    expect(inline?.anchorStatus).toBe('ANCHORED');
  });
});

describe('resolver, editar y borrar', () => {
  it('resolver y reabrir deja constancia de quién', async () => {
    const [thread] = await hilos();

    const resuelto = (await (
      await h.as(bruno).post(`/api/v1/threads/${thread!.id}/resolve`)
    ).json()) as Thread & { resolvedByHandle: string };
    expect(resuelto.status).toBe('RESOLVED');
    expect(resuelto.resolvedByHandle).toBe('bruno');

    const reabierto = (await (
      await h.as(ana).post(`/api/v1/threads/${thread!.id}/reopen`)
    ).json()) as Thread;
    expect(reabierto.status).toBe('OPEN');
  });

  it('solo se edita lo propio', async () => {
    const [thread] = await hilos();
    const ajeno = thread!.comments[0]!;

    // El primer comentario del primer hilo es de Bruno.
    const response = await h.as(ana).patch(`/api/v1/comments/${ajeno.id}`, { body: 'Reescrito' });
    expect(response.status).toBe(403);
  });

  it('borrar un comentario conserva el hilo y la autoría', async () => {
    const creado = (await (
      await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Me arrepentiré' })
    ).json()) as Thread;
    const comentario = creado.comments[0]!;

    expect((await h.as(ana).delete(`/api/v1/comments/${comentario.id}`)).status).toBe(204);

    const despues = (await hilos()).find((t) => t.id === creado.id);
    expect(despues?.comments[0]?.isDeleted).toBe(true);
    // El texto no se envía, pero el comentario sigue ahí.
    expect(despues?.comments[0]?.body).toBe('');
  });

  it('el precursor puede borrar un hilo ajeno; otro miembro no', async () => {
    const deBruno = (await (
      await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, { body: 'Hilo de Bruno' })
    ).json()) as Thread;

    const deAna = (await (
      await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Hilo de Ana' })
    ).json()) as Thread;

    // Bruno no puede borrar el hilo de Ana.
    expect((await h.as(bruno).delete(`/api/v1/threads/${deAna.id}`)).status).toBe(403);
    // Ana, como precursora de la app, sí puede borrar el de Bruno.
    expect((await h.as(ana).delete(`/api/v1/threads/${deBruno.id}`)).status).toBe(204);
  });
});

describe('menciones (RF-815)', () => {
  it('solo se ofrecen miembros del workspace', async () => {
    const carla = await h.createUser('carla');
    const lista = (await (await h.as(ana).get(`/api/v1/apps/${appId}/mentionable`)).json()) as {
      handle: string;
    }[];

    expect(lista.map((u) => u.handle).sort()).toEqual(['ana', 'bruno']);
    expect(lista.map((u) => u.handle)).not.toContain(carla.handle);
  });

  it('mencionar a alguien de fuera no falla, simplemente no cuenta', async () => {
    const response = await h.as(ana).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Aviso a @bruno y también a @carla, que no está aquí',
    });
    const thread = (await response.json()) as Thread;

    // Rechazarlo con un error diría que ese handle existe pero no pertenece.
    expect(response.status).toBe(201);
    expect(thread.comments[0]?.mentions).toEqual(['bruno']);
  });
});

describe('aislamiento', () => {
  it('quien no ve la app no ve sus hilos', async () => {
    const carla = await h.createUser('carla-fuera');
    expect((await h.as(carla).get(`/api/v1/apps/${appId}/threads`)).status).toBe(404);
  });
});
