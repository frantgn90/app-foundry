import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * El catálogo de modelos, leído del proveedor.
 *
 * El de mentira devuelve dos modelos fijos, así que lo que se comprueba aquí no
 * es qué modelos hay sino de dónde salen y quién los ve.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;

interface ModelBody {
  provider: string;
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  available: boolean;
}

const modelos = (user: TestUser, quien: TestUser) =>
  h.as(quien).get(`/api/v1/workspaces/${user.workspaceId}/ai/models`);

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('sin proveedores configurados', () => {
  /*
   * Ofrecer modelos de un proveedor sin credencial invitaría a asignar algo que
   * después no se puede invocar.
   */
  it('no hay catálogo que enseñar', async () => {
    const response = await modelos(ana, ana);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});

describe('con un proveedor configurado', () => {
  beforeAll(async () => {
    await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
    await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
      apiKey: 'sk-de-mentira-pero-larga',
    });
  });

  it('el catálogo sale del proveedor, no de una tabla escrita a mano', async () => {
    const body = (await (await modelos(ana, ana)).json()) as ModelBody[];

    expect(body.length).toBeGreaterThan(0);
    expect(body.every((m) => m.provider === 'ANTHROPIC')).toBe(true);
    expect(body[0]?.available).toBe(true);
  });

  /* De aquí depende poder rechazar a tiempo lo que no cabe (RF-1106). */
  it('trae la ventana de contexto y el tope de salida', async () => {
    const body = (await (await modelos(ana, ana)).json()) as ModelBody[];

    expect(body[0]?.contextWindow).toBeGreaterThan(0);
    expect(body[0]?.maxOutputTokens).toBeGreaterThan(0);
  });

  it('solo aparecen los proveedores que este workspace tiene', async () => {
    const body = (await (await modelos(ana, ana)).json()) as ModelBody[];

    expect(body.some((m) => m.provider === 'GROQ')).toBe(false);
  });

  /* Quien no elige modelo tampoco necesita la lista (RF-1107). */
  it('un miembro que no es dueño no lo consulta', async () => {
    expect((await modelos(ana, bruno)).status).toBe(403);
  });

  it('la segunda consulta ya no vuelve a preguntarle al proveedor', async () => {
    const primera = (await (await modelos(ana, ana)).json()) as ModelBody[];
    const segunda = (await (await modelos(ana, ana)).json()) as ModelBody[];

    expect(segunda).toEqual(primera);
  });
});
