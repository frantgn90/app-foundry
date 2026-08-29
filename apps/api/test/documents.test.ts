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
  };
}

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

describe('guardar versiones', () => {
  it('cada guardado crea una versión con su autor y su mensaje', async () => {
    const antes = await documento();

    const response = await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: '# The problem\n\nI read a lot and remember little.',
      baseVersionId: antes.currentVersionId,
      message: 'First real pass',
    });
    expect(response.status).toBe(200);

    const versions = (await (
      await h.as(ana).get(`/api/v1/apps/${appId}/document/versions`)
    ).json()) as { versionNo: number; authorHandle: string; message: string | null }[];

    expect(versions[0]).toMatchObject({
      versionNo: 2,
      authorHandle: 'ana',
      message: 'First real pass',
    });
  });
});

/**
 * La deuda declarada en H2: hasta ahora esto solo se había comprobado a mano, y
 * es la pieza más delicada escrita en todo el proyecto.
 */
describe('conflictos al guardar (RF-511)', () => {
  it('guardar desde una versión que ya no es la actual devuelve 409 y no sobrescribe', async () => {
    const base = await documento();

    // Alguien guarda primero.
    await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: 'Lo que escribió el primero',
      baseVersionId: base.currentVersionId,
    });

    // El segundo llega con la versión base antigua.
    const response = await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: 'Lo que habría pisado al primero',
      baseVersionId: base.currentVersionId,
    });

    expect(response.status).toBe(409);

    const conflict = (await response.json()) as {
      message: string;
      currentContent: string;
      currentVersionNo: number;
      lastAuthorHandle: string;
    };

    // No basta con rechazar: la respuesta trae lo que hay guardado ahora, que
    // es lo que la interfaz necesita para enseñar el conflicto.
    expect(conflict.currentContent).toBe('Lo que escribió el primero');
    expect(conflict.lastAuthorHandle).toBe('ana');
    expect(conflict.message).toMatch(/saved a new version/i);

    // Y lo fundamental: el contenido del primero sigue intacto.
    const despues = await documento();
    expect(despues.content).toBe('Lo que escribió el primero');
  });

  it('dos guardados simultáneos desde la misma base: solo uno gana', async () => {
    const base = await documento();

    // Salen a la vez y compiten de verdad. El bloqueo del documento es lo que
    // impide que ambos lean la misma versión actual y se den los dos por
    // buenos, pisando el segundo al primero.
    const [uno, dos] = await Promise.all([
      h.as(ana).put(`/api/v1/apps/${appId}/document`, {
        content: 'Versión A',
        baseVersionId: base.currentVersionId,
      }),
      h.as(ana).put(`/api/v1/apps/${appId}/document`, {
        content: 'Versión B',
        baseVersionId: base.currentVersionId,
      }),
    ]);

    const estados = [uno.status, dos.status].sort();
    expect(estados).toEqual([200, 409]);

    const final = await documento();
    expect(['Versión A', 'Versión B']).toContain(final.content);
  });
});

describe('historial', () => {
  it('restaurar crea una versión nueva sin borrar las anteriores', async () => {
    const versions = (await (
      await h.as(ana).get(`/api/v1/apps/${appId}/document/versions`)
    ).json()) as { id: string; versionNo: number }[];

    const primera = versions.find((v) => v.versionNo === 1);
    const total = versions.length;

    const response = await h
      .as(ana)
      .post(`/api/v1/apps/${appId}/document/restore/${primera?.id ?? ''}`);
    expect(response.status).toBe(201);

    const despues = (await (
      await h.as(ana).get(`/api/v1/apps/${appId}/document/versions`)
    ).json()) as { versionNo: number }[];

    expect(despues).toHaveLength(total + 1);

    const doc = await documento();
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
