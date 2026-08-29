import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * La matriz de permisos, comprobada a través de HTTP.
 *
 * Los 56 tests de `packages/db` verifican las políticas en SQL. Estos verifican
 * lo que de verdad ve alguien usando la aplicación: entre una política correcta
 * y una respuesta correcta hay endpoints, guards e interceptores que también
 * pueden equivocarse.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;

/** Apps de Ana, una por nivel de acceso. */
const apps: Record<string, string> = {};

async function crearApp(dueño: TestUser, nombre: string, nivel?: string): Promise<string> {
  const response = await h.as(dueño).post(`/api/v1/workspaces/${dueño.workspaceId}/apps`, {
    name: nombre,
    ...(nivel ? { accessLevel: nivel } : {}),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  apps['privada'] = await crearApp(ana, 'Privada', 'PRIVATE');
  apps['lectura'] = await crearApp(ana, 'Lectura', 'WORKSPACE_READ');
  apps['escritura'] = await crearApp(ana, 'Escritura', 'WORKSPACE_WRITE');

  // Ana invita a Bruno a su workspace; Carla queda fuera de todo.
  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, {
    email: bruno.email,
  });
});

afterAll(async () => {
  await h?.stop();
});

describe('sin sesión', () => {
  it('no se llega a ninguna parte', async () => {
    for (const path of [
      '/api/v1/auth/me',
      '/api/v1/workspaces',
      `/api/v1/apps/${apps['privada']}`,
    ]) {
      expect((await h.anonymous().get(path)).status).toBe(401);
    }
  });

  it('salvo a las comprobaciones de salud, que consulta un orquestador', async () => {
    expect((await h.anonymous().get('/health/live')).status).toBe(200);
  });
});

describe('la invitación surte efecto de inmediato para quien ya tiene cuenta', () => {
  it('Bruno ve ahora dos workspaces: el suyo y el de Ana', async () => {
    const workspaces = (await (await h.as(bruno).get('/api/v1/workspaces')).json()) as {
      slug: string;
      role: string;
    }[];
    expect(workspaces.map((w) => w.slug).sort()).toEqual(['ana', 'bruno']);
    expect(workspaces.find((w) => w.slug === 'ana')?.role).toBe('MEMBER');
  });

  it('Carla sigue viendo solo el suyo', async () => {
    const workspaces = (await (await h.as(carla).get('/api/v1/workspaces')).json()) as {
      slug: string;
    }[];
    expect(workspaces.map((w) => w.slug)).toEqual(['carla']);
  });
});

describe('qué apps ve cada uno', () => {
  it('Ana ve las tres suyas', async () => {
    const lista = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as { name: string }[];
    expect(lista.map((a) => a.name).sort()).toEqual(['Escritura', 'Lectura', 'Privada']);
  });

  it('Bruno ve las compartidas pero no la privada', async () => {
    const lista = (await (
      await h.as(bruno).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as { name: string }[];
    expect(lista.map((a) => a.name).sort()).toEqual(['Escritura', 'Lectura']);
  });

  it('pedir directamente la privada tampoco funciona', async () => {
    expect((await h.as(bruno).get(`/api/v1/apps/${apps['privada']}`)).status).toBe(404);
  });

  it('Carla no ve nada del workspace de Ana, ni siquiera que existe', async () => {
    // 404 y no 403: decir «no tienes permiso» ya confirmaría que existe.
    expect((await h.as(carla).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)).status).toBe(200);
    const lista = (await (
      await h.as(carla).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as unknown[];
    expect(lista).toHaveLength(0);
    expect((await h.as(carla).get(`/api/v1/apps/${apps['escritura']}`)).status).toBe(404);
  });
});

describe('quién puede escribir', () => {
  it('en WORKSPACE_WRITE, Bruno edita y queda como contribuidor', async () => {
    const doc = (await (
      await h.as(bruno).get(`/api/v1/apps/${apps['escritura']}/document`)
    ).json()) as { currentVersionId: string; canEdit: boolean };
    expect(doc.canEdit).toBe(true);

    const response = await h.as(bruno).put(`/api/v1/apps/${apps['escritura']}/document`, {
      content: 'Lo que aporta Bruno',
      baseVersionId: doc.currentVersionId,
    });
    expect(response.status).toBe(200);

    // Contribuidor sin que nadie se lo haya concedido: se gana escribiendo.
    const contributors = (await (
      await h.as(ana).get(`/api/v1/apps/${apps['escritura']}/document/contributors`)
    ).json()) as { handle: string }[];
    expect(contributors.map((c) => c.handle)).toContain('bruno');
  });

  it('en WORKSPACE_READ, Bruno lee pero no escribe', async () => {
    const doc = (await (
      await h.as(bruno).get(`/api/v1/apps/${apps['lectura']}/document`)
    ).json()) as { currentVersionId: string; canEdit: boolean };

    expect(doc.canEdit).toBe(false);

    const response = await h.as(bruno).put(`/api/v1/apps/${apps['lectura']}/document`, {
      content: 'No debería entrar',
      baseVersionId: doc.currentVersionId,
    });
    expect(response.status).toBe(403);
  });
});

describe('lo que crea un invitado nace compartido (D-9)', () => {
  it('Bruno crea una app en el workspace de Ana y sale en WORKSPACE_WRITE', async () => {
    const response = await h.as(bruno).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
      name: 'De Bruno',
      // Pide privada explícitamente y el servidor no se lo concede.
      accessLevel: 'PRIVATE',
    });
    const app = (await response.json()) as { id: string; accessLevel: string };
    expect(app.accessLevel).toBe('WORKSPACE_WRITE');
    apps['deBruno'] = app.id;
  });

  it('ni él ni la dueña del workspace pueden cambiarle el nivel después', async () => {
    for (const quien of [bruno, ana]) {
      const response = await h
        .as(quien)
        .patch(`/api/v1/apps/${apps['deBruno']}/access-level`, { accessLevel: 'PRIVATE' });
      expect(response.status).toBe(403);
    }
  });
});

describe('administrar el workspace es cosa de su dueño', () => {
  it('Bruno no puede invitar a nadie al workspace de Ana', async () => {
    const response = await h.as(bruno).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, {
      email: 'colado@example.com',
    });
    expect(response.status).toBe(403);
  });

  it('Bruno no ve las invitaciones de Ana', async () => {
    expect(
      (await h.as(bruno).get(`/api/v1/workspaces/${ana.workspaceId}/invitations`)).status,
    ).toBe(403);
  });

  it('Ana no puede abandonar su propio workspace', async () => {
    const response = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/leave`);
    expect(response.status).toBe(403);
  });
});

describe('al salir del workspace, las apps se quedan (D-10)', () => {
  it('Bruno se va y su app pasa a Ana', async () => {
    expect((await h.as(bruno).post(`/api/v1/workspaces/${ana.workspaceId}/leave`)).status).toBe(
      204,
    );

    const app = (await (await h.as(ana).get(`/api/v1/apps/${apps['deBruno']}`)).json()) as {
      precursorHandle: string;
    };
    expect(app.precursorHandle).toBe('ana');
  });

  it('y Bruno deja de ver el workspace al instante', async () => {
    const workspaces = (await (await h.as(bruno).get('/api/v1/workspaces')).json()) as {
      slug: string;
    }[];
    expect(workspaces.map((w) => w.slug)).toEqual(['bruno']);
    expect((await h.as(bruno).get(`/api/v1/apps/${apps['escritura']}`)).status).toBe(404);
  });

  it('pero su autoría en el historial permanece', async () => {
    const versions = (await (
      await h.as(ana).get(`/api/v1/apps/${apps['escritura']}/document/versions`)
    ).json()) as { authorHandle: string }[];
    expect(versions.map((v) => v.authorHandle)).toContain('bruno');
  });
});
