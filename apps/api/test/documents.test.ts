import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let ana: TestUser;
let appId: string;

async function crearApp(nombre: string): Promise<string> {
  const response = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
    name: nombre,
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function documento() {
  const response = await h.as(ana).get(`/api/v1/apps/${appId}/document`);
  return (await response.json()) as {
    content: string;
    currentVersionId: string;
    versionNo: number;
    revision: number;
    uncommittedChanges: boolean;
    workingAuthors: { handle: string }[];
  };
}

interface Version {
  id: string;
  versionNo: number;
  authorHandle: string;
  coauthorHandles: string[];
  message: string | null;
}

async function historial(): Promise<Version[]> {
  const response = await h.as(ana).get(`/api/v1/apps/${appId}/document/versions`);
  return (await response.json()) as Version[];
}

const versionesDe = (versions: Version[]) => versions.map((v) => v.versionNo);

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  appId = await crearApp('Reading Companion');
});

afterAll(async () => {
  await h?.stop();
});

describe('crear una app deja su visión lista', () => {
  it('nace con la plantilla y su primera versión', async () => {
    const doc = await documento();
    expect(doc.versionNo).toBe(1);
    expect(doc.content).toContain('# The problem');
    expect(doc.currentVersionId).toBeTruthy();
  });
});

describe('guardar no es versionar (RF-505)', () => {
  it('varios guardados dejan una sola versión y la copia de trabajo por delante', async () => {
    const antes = await documento();

    for (const texto of ['# The problem\n\nUn primer intento.', '# The problem\n\nY otro mejor.']) {
      const response = await h
        .as(ana)
        .put(`/api/v1/apps/${appId}/document`, { content: texto, revision: (await documento()).revision });
      expect(response.status).toBe(200);
    }

    const despues = await documento();
    // La versión no se ha movido; la revisión sí, una por guardado.
    expect(despues.versionNo).toBe(antes.versionNo);
    expect(despues.revision).toBe(antes.revision + 2);
    expect(despues.uncommittedChanges).toBe(true);
    expect(despues.content).toContain('Y otro mejor');
    expect(versionesDe(await historial())).toEqual([1]);
  });

  it('guardar lo mismo que ya hay no cuenta como cambio', async () => {
    const antes = await documento();
    await h
      .as(ana)
      .put(`/api/v1/apps/${appId}/document`, { content: antes.content, revision: antes.revision });

    expect((await documento()).revision).toBe(antes.revision);
  });

  it('quien guarda queda apuntado hasta que se commitea', async () => {
    expect((await documento()).workingAuthors.map((a) => a.handle)).toEqual(['ana']);
  });

  it('commitear crea la versión con su mensaje y su autor', async () => {
    const response = await h.as(ana).post(`/api/v1/apps/${appId}/document/commit`, {
      message: 'First real pass',
      revision: (await documento()).revision,
    });
    expect(response.status).toBe(201);

    const versions = await historial();
    expect(versions[0]).toMatchObject({
      versionNo: 2,
      authorHandle: 'ana',
      message: 'First real pass',
    });

    const doc = await documento();
    expect(doc.uncommittedChanges).toBe(false);
    expect(doc.workingAuthors).toEqual([]);
  });

  it('commitear sin cambios no crea una versión gemela', async () => {
    const response = await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/commit`, {
        message: 'Otra vez lo mismo',
        revision: (await documento()).revision,
      });
    expect(response.status).toBe(400);
    expect(versionesDe(await historial())).toEqual([2, 1]);
  });

  it('el mensaje es obligatorio y cabe en cien caracteres', async () => {
    const doc = await documento();
    await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: 'Algo que commitear',
      revision: doc.revision,
    });

    const sinMensaje = await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/commit`, { revision: (await documento()).revision });
    expect(sinMensaje.status).toBe(400);

    const demasiado = await h.as(ana).post(`/api/v1/apps/${appId}/document/commit`, {
      message: 'x'.repeat(101),
      revision: (await documento()).revision,
    });
    expect(demasiado.status).toBe(400);

    // Y lo escrito sigue ahí: un mensaje mal puesto no se lleva el texto.
    expect((await documento()).content).toBe('Algo que commitear');
  });
});

describe('descartar los cambios sin commitear (RF-515)', () => {
  it('devuelve la copia de trabajo a la versión, y no deja rastro en el historial', async () => {
    const antes = await documento();
    expect(antes.uncommittedChanges).toBe(true);

    const response = await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/reset`, { revision: antes.revision });
    expect(response.status).toBe(201);

    const despues = await documento();
    expect(despues.uncommittedChanges).toBe(false);
    expect(despues.content).toContain('Y otro mejor');
    expect(despues.workingAuthors).toEqual([]);
    expect(versionesDe(await historial())).toEqual([2, 1]);
  });

  it('sin nada que descartar, se dice y no se toca nada', async () => {
    const response = await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/reset`, { revision: (await documento()).revision });
    expect(response.status).toBe(400);
  });
});

/**
 * La deuda declarada en H2: hasta ahora esto solo se había comprobado a mano, y
 * es la pieza más delicada escrita en todo el proyecto.
 */
describe('conflictos al guardar (RF-511)', () => {
  it('guardar desde una revisión que ya no es la actual devuelve 409 y no sobrescribe', async () => {
    const base = await documento();

    // Alguien guarda primero.
    await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: 'Lo que escribió el primero',
      revision: base.revision,
    });

    // El segundo llega con la revisión antigua.
    const response = await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: 'Lo que habría pisado al primero',
      revision: base.revision,
    });

    expect(response.status).toBe(409);

    const conflict = (await response.json()) as {
      message: string;
      currentContent: string;
      currentVersionNo: number;
      revision: number;
      lastAuthorHandle: string;
    };

    // No basta con rechazar: la respuesta trae lo que hay guardado ahora, que
    // es lo que la interfaz necesita para enseñar el conflicto, y la revisión
    // buena para poder reintentar sin recargar.
    expect(conflict.currentContent).toBe('Lo que escribió el primero');
    expect(conflict.lastAuthorHandle).toBe('ana');
    expect(conflict.revision).toBe(base.revision + 1);
    expect(conflict.message).toMatch(/saved while you were editing/i);

    // Y lo fundamental: el contenido del primero sigue intacto.
    const despues = await documento();
    expect(despues.content).toBe('Lo que escribió el primero');
  });

  it('la misma comprobación protege al commit y al descarte', async () => {
    const vieja = (await documento()).revision - 1;

    expect(
      (await h.as(ana).post(`/api/v1/apps/${appId}/document/commit`, { message: 'Tarde', revision: vieja }))
        .status,
    ).toBe(409);
    expect(
      (await h.as(ana).post(`/api/v1/apps/${appId}/document/reset`, { revision: vieja })).status,
    ).toBe(409);
  });

  it('dos guardados simultáneos desde la misma base: solo uno gana', async () => {
    const base = await documento();

    // Salen a la vez y compiten de verdad. El bloqueo del documento es lo que
    // impide que ambos lean la misma revisión y se den los dos por buenos,
    // pisando el segundo al primero.
    const [uno, dos] = await Promise.all([
      h.as(ana).put(`/api/v1/apps/${appId}/document`, {
        content: 'Versión A',
        revision: base.revision,
      }),
      h.as(ana).put(`/api/v1/apps/${appId}/document`, {
        content: 'Versión B',
        revision: base.revision,
      }),
    ]);

    const estados = [uno.status, dos.status].sort();
    expect(estados).toEqual([200, 409]);

    const final = await documento();
    expect(['Versión A', 'Versión B']).toContain(final.content);
  });
});

describe('historial', () => {
  it('restaurar deja el texto viejo sin commitear, para poder mirarlo antes', async () => {
    const versions = await historial();
    const primera = versions.find((v) => v.versionNo === 1);
    const total = versions.length;

    const response = await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/restore/${primera?.id ?? ''}`);
    expect(response.status).toBe(201);

    // No hay versión nueva: restaurar ya no decide por ti. Queda en la copia de
    // trabajo, para leerla, seguir editándola y ponerle mensaje al commitear.
    expect(await historial()).toHaveLength(total);

    const doc = await documento();
    expect(doc.uncommittedChanges).toBe(true);
    expect(doc.content).toContain('# The problem');
  });

  it('el documento se exporta con su cabecera de metadatos', async () => {
    const response = await h.as(ana).get(`/api/v1/apps/${appId}/document/export`);
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(response.headers.get('content-disposition')).toContain('VISION.md');
    expect(body).toMatch(/^---\napp: Reading Companion/);
    expect(body).toContain('exported_by: ana');
  });
});

/**
 * Quien escribe y no commitea (RF-516).
 *
 * Es el caso que el modelo nuevo podía perder: antes, guardar era versionar y
 * la autoría se apuntaba sola. Ahora, si nadie lo guarda, el trabajo de quien
 * escribió desaparece del historial en cuanto lo commitee otro.
 */
describe('coautoría', () => {
  let bruno: TestUser;
  let compartida: string;

  beforeAll(async () => {
    bruno = await h.createUser('bruno');
    await h
      .as(ana)
      .post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

    compartida = await crearApp('A cuatro manos');
    await h
      .as(ana)
      .patch(`/api/v1/apps/${compartida}/access-level`, { accessLevel: 'WORKSPACE_WRITE' });
  });

  it('quien guarda sin commitear queda como coautor de la versión', async () => {
    const doc = (await (
      await h.as(bruno).get(`/api/v1/apps/${compartida}/document`)
    ).json()) as { revision: number };

    await h.as(bruno).put(`/api/v1/apps/${compartida}/document`, {
      content: '# The problem\n\nLo escribe Bruno.',
      revision: doc.revision,
    });

    const guardado = (await (
      await h.as(ana).get(`/api/v1/apps/${compartida}/document`)
    ).json()) as { revision: number; workingAuthors: { handle: string }[] };

    // Antes de commitear ya se sabe de quién es lo que hay sin guardar: es lo
    // que hace que descartarlo no sea a ciegas (RF-515).
    expect(guardado.workingAuthors.map((a) => a.handle)).toEqual(['bruno']);

    await h.as(ana).post(`/api/v1/apps/${compartida}/document/commit`, {
      message: 'Lo de Bruno, commiteado por mí',
      revision: guardado.revision,
    });

    const versions = (await (
      await h.as(ana).get(`/api/v1/apps/${compartida}/document/versions`)
    ).json()) as { versionNo: number; authorHandle: string; coauthorHandles: string[] }[];

    expect(versions[0]).toMatchObject({ versionNo: 2, authorHandle: 'ana' });
    expect(versions[0]!.coauthorHandles).toEqual(['bruno']);

    // Y cuenta como contribución, que es de lo que se trataba (RF-509).
    const contributors = (await (
      await h.as(ana).get(`/api/v1/apps/${compartida}/document/contributors`)
    ).json()) as { handle: string }[];
    expect(contributors.map((c) => c.handle)).toContain('bruno');
  });
});
