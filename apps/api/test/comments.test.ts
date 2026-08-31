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
  versionId: string | null;
  versionNo: number | null;
  anchorStatus: string | null;
  anchorQuote: string | null;
  anchorStart: number | null;
  canDelete: boolean;
  comments: { id: string; body: string; isDeleted: boolean; mentions: string[] }[];
}

interface Threads {
  threads: Thread[];
  openElsewhere: { versionId: string; versionNo: number; openThreads: number }[];
}

async function documento() {
  const response = await h.as(ana).get(`/api/v1/apps/${appId}/document`);
  return (await response.json()) as {
    content: string;
    currentVersionId: string;
    revision: number;
    versionNo: number;
    uncommittedChanges: boolean;
  };
}

async function listado(user: TestUser = ana, versionId?: string): Promise<Threads> {
  const url = versionId
    ? `/api/v1/apps/${appId}/threads?versionId=${versionId}`
    : `/api/v1/apps/${appId}/threads`;
  return (await (await h.as(user).get(url)).json()) as Threads;
}

async function hilos(user: TestUser = ana): Promise<Thread[]> {
  return (await listado(user)).threads;
}

/** Guarda en la copia de trabajo. */
async function guardar(content: string) {
  const doc = await documento();
  return h.as(ana).put(`/api/v1/apps/${appId}/document`, { content, revision: doc.revision });
}

/** Guarda y commitea, que es lo que crea versión. */
async function commitear(content: string, message = 'Cambio') {
  await guardar(content);
  const doc = await documento();
  return h.as(ana).post(`/api/v1/apps/${appId}/document/commit`, { message, revision: doc.revision });
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
  await commitear(
    '# The problem\n\nDeciding what to build is guesswork.\n\n# Who\n\nSmall teams.\n',
    'Primera pasada',
  );
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

/**
 * Un comentario habla de un texto concreto (RF-817).
 *
 * Por eso pertenece a la versión sobre la que se escribió y solo se lee ahí:
 * arrastrarlo a la siguiente sería ponerlo a hablar de un párrafo que a lo
 * mejor ya no dice lo mismo.
 */
describe('cada hilo, en su versión', () => {
  let versionAlComentar: string;
  let posicion: number;
  let hiloInline: string;
  let hiloGeneral: string;

  beforeAll(async () => {
    // Se parte de una versión limpia y conocida.
    await commitear('# The problem\n\nDeciding what to build is guesswork.\n', 'Punto de partida');
    const doc = await documento();
    versionAlComentar = doc.currentVersionId;
    posicion = doc.content.indexOf(fragmento);

    const inline = await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, {
      body: '¿Seguro que es adivinar?',
      quote: fragmento,
      start: posicion,
      end: posicion + fragmento.length,
      versionId: versionAlComentar,
    });
    expect(inline.status).toBe(201);
    hiloInline = ((await inline.json()) as Thread).id;

    const general = await h
      .as(bruno)
      .post(`/api/v1/apps/${appId}/threads`, { body: 'Una duda sobre la idea, no sobre el texto' });
    hiloGeneral = ((await general.json()) as Thread).id;
  });

  it('mientras no se commitea, el hilo se lee sobre la copia de trabajo', async () => {
    await guardar('# Context\n\nAlgo nuevo arriba.\n\n# The problem\n\nDeciding what to build is guesswork.\n');

    const enTrabajo = (await listado()).threads.find((t) => t.id === hiloInline);
    expect(enTrabajo?.anchorStatus).toBe('ANCHORED');

    // Se ha desplazado hacia abajo con el texto, sin dejar de ser el de su
    // versión: sobre ella sigue estando donde estaba.
    const doc = await documento();
    expect(doc.content.slice(enTrabajo!.anchorStart!, enTrabajo!.anchorStart! + fragmento.length)).toBe(
      fragmento,
    );
    const enSuVersion = (await listado(ana, versionAlComentar)).threads.find(
      (t) => t.id === hiloInline,
    );
    expect(enSuVersion?.anchorStart).toBe(posicion);
  });

  it('al commitear, el hilo se queda en su versión y se anuncia desde la nueva', async () => {
    const doc = await documento();
    await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/commit`, { message: 'Añado contexto', revision: doc.revision });

    const ahora = await listado();
    // El inline se queda atrás; el general sigue, que es de la app (RF-801).
    expect(ahora.threads.map((t) => t.id)).not.toContain(hiloInline);
    expect(ahora.threads.map((t) => t.id)).toContain(hiloGeneral);

    // Pero no desaparece sin más: se dice cuántos quedan vivos y dónde.
    const atras = ahora.openElsewhere.find((v) => v.versionId === versionAlComentar);
    expect(atras?.openThreads).toBe(1);

    // Y desde su versión se lee entero.
    const enSuVersion = (await listado(ana, versionAlComentar)).threads.find(
      (t) => t.id === hiloInline,
    );
    expect(enSuVersion?.comments[0]?.body).toBe('¿Seguro que es adivinar?');
  });

  it('no se comenta sobre una versión que no es la actual', async () => {
    const response = await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Un comentario tardío',
      quote: fragmento,
      start: posicion,
      end: posicion + fragmento.length,
      versionId: versionAlComentar,
    });

    // Nacería anclado a un texto que ya nadie mira, y quien lo escribe creería
    // estar hablando con alguien.
    expect(response.status).toBe(400);
  });

  it('pero los que se quedaron atrás se siguen resolviendo', async () => {
    const response = await h.as(ana).post(`/api/v1/threads/${hiloInline}/resolve`);
    expect(response.status).toBe(201);
    expect(((await response.json()) as Thread).status).toBe('RESOLVED');

    // Y al resolverse deja de reclamar atención desde la versión de hoy: era el
    // único vivo que quedaba en la suya.
    const atras = (await listado()).openElsewhere.find((v) => v.versionId === versionAlComentar);
    expect(atras).toBeUndefined();
  });
});
