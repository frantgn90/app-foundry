import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Los caminos de error.
 *
 * Buena parte de las reglas viven en la base de datos y rechazan con un
 * SQLSTATE. Estos tests comprueban que llegan al cliente como respuestas que
 * puede entender, y no como errores internos.
 */
let h: Harness;
let ana: TestUser;
let appId: string;

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  const response = await h
    .as(ana)
    .post(`/api/v1/workspaces/${ana.workspaceId}/apps`, { name: 'Una idea' });
  appId = ((await response.json()) as { id: string }).id;
});

afterAll(async () => {
  await h?.stop();
});

describe('no revelar lo que no se puede ver', () => {
  it('un recurso ajeno responde 404 y no 403', async () => {
    const otra = await h.createUser('otra');
    // 403 diría «existe, pero no es tuyo», que ya es más de lo que debe saber.
    expect((await h.as(otra).get(`/api/v1/apps/${appId}`)).status).toBe(404);
  });

  it('un identificador que no es un uuid se rechaza antes de tocar nada', async () => {
    expect((await h.as(ana).get('/api/v1/apps/no-soy-un-uuid')).status).toBe(400);
  });
});

describe('los rechazos del motor llegan traducidos', () => {
  it('editar una app archivada da 403 con un mensaje legible', async () => {
    await h.as(ana).post(`/api/v1/apps/${appId}/archive`);

    const response = await h.as(ana).patch(`/api/v1/apps/${appId}`, { name: 'Colado' });
    expect(response.status).toBe(403);

    const body = (await response.json()) as { message: string };
    expect(body.message).toMatch(/archived/i);
    // Y sin filtrar la forma del esquema: el mensaje de Drizzle incluiría la
    // consulta entera con sus columnas.
    expect(body.message).not.toMatch(/update .*set|select .*from/i);

    await h.as(ana).post(`/api/v1/apps/${appId}/unarchive`);
  });
});

describe('validación de entrada', () => {
  it('un campo que no existe se rechaza en lugar de ignorarse', async () => {
    // Casi siempre es una errata en el nombre, y aceptarlo en silencio haría
    // creer que el cambio se guardó.
    const response = await h.as(ana).patch(`/api/v1/apps/${appId}`, { nombre: 'x' });
    expect(response.status).toBe(400);
  });

  it('un enlace de repositorio que no es una URL se rechaza', async () => {
    const response = await h.as(ana).patch(`/api/v1/apps/${appId}`, { repoUrl: 'no-es-una-url' });
    expect(response.status).toBe(400);
  });

  it('un emoji fuera del catálogo curado se rechaza', async () => {
    const response = await h.as(ana).patch(`/api/v1/apps/${appId}`, { iconEmoji: '🦄' });
    expect(response.status).toBe(400);
  });
});

describe('salud', () => {
  it('ready comprueba las dependencias y responde con sus latencias', async () => {
    const response = await h.anonymous().get('/health/ready');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      checks: Record<string, { status: string; latencyMs: number }>;
    };
    expect(body.status).toBe('ok');
    expect(Object.keys(body.checks).sort()).toEqual(['postgres', 'redis']);
  });
});
