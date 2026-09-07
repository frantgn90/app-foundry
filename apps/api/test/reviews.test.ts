import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AiProvider } from '@app-foundry/core';
import { AI_REGISTRY } from '@app-foundry/ai-runtime';
import type { ProviderRegistry } from '@app-foundry/ai';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * El techo de una revisión, antes de gastar nada (RF-1207, RF-1608).
 *
 * Lo que se comprueba es lo que hace útil a la cifra: que la pida quien solo
 * **lee** la app, que sume un agente por cada uno que va a intervenir, que sea
 * un techo —entrada contada y salida al máximo— y que diga si cabe en lo que
 * queda del cupo, porque una revisión que no cabe no arranca.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;

/** Una app que Bruno ve pero no edita, para la regla que se sale de lo normal. */
let appDeAna: string;
let plantillaPO: string;
let plantillaDevil: string;

interface Techo {
  agents: { agentId: string; handle: string; estimatedTokens: number }[];
  totalTokens: number;
  provider: string;
  modelId: string;
  versionNo: number;
  fitsInQuota: boolean;
  remainingTokens: number | null;
}

const estimar = (quien: TestUser, appId = appDeAna) =>
  h.as(quien).post(`/api/v1/apps/${appId}/reviews/estimate`, {});

/** Crea una app con su visión commiteada, para tener qué revisar. */
async function appConVision(quien: TestUser, name: string, accessLevel: string): Promise<string> {
  const app = (await (
    await h.as(quien).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, { name, accessLevel })
  ).json()) as { id: string };

  const doc = (await (await h.as(quien).get(`/api/v1/apps/${app.id}/document`)).json()) as {
    revision: number;
  };

  const guardado = (await (
    await h.as(quien).put(`/api/v1/apps/${app.id}/document`, {
      content: '# El problema\n\nApuntar una idea cuesta demasiado, y se pierde por el camino.\n',
      revision: doc.revision,
    })
  ).json()) as { revision: number };

  await h.as(quien).post(`/api/v1/apps/${app.id}/document/commit`, {
    message: 'Primera',
    revision: guardado.revision,
  });

  return app.id;
}

/**
 * Adopta un perfil del catálogo. Una vez por workspace: el handle es único ahí,
 * así que adoptarlo dos veces choca (RF-1515).
 */
async function adoptar(key: string): Promise<string> {
  const plantilla = (await (
    await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/catalog/${key}`, {})
  ).json()) as { id: string };

  return plantilla.id;
}

async function ponerAgente(appId: string, templateId: string): Promise<void> {
  const res = await h.as(ana).post(`/api/v1/apps/${appId}/agents`, { templateId });
  expect(res.status).toBe(201);
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

  /* La IA del workspace, con el proveedor de mentira detrás (T-36). */
  const registro = h.resolve<ProviderRegistry>(AI_REGISTRY);
  expect(registro.get(AiProvider.ANTHROPIC)).toBeDefined();

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
  await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
    apiKey: 'sk-de-mentira-anthropic',
  });

  plantillaPO = await adoptar('product-owner');
  plantillaDevil = await adoptar('devils-advocate');

  appDeAna = await appConVision(ana, 'Con revisión', 'WORKSPACE_READ');
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('sin nada que revisar', () => {
  it('sin agentes activos no hay revisión que pedir', async () => {
    const res = await estimar(ana);

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('no active agents');
  });

  it('y sin versión commiteada tampoco, aunque haya agentes', async () => {
    /*
     * Crear una app deja ya su primera versión, así que este estado no se
     * alcanza por la puerta normal: se fabrica a mano. La comprobación se
     * queda igualmente porque revisar sobre nada no es un caso raro, es un
     * caso imposible que hay que decir en vez de estimar en cero (RF-1607).
     */
    const app = (await (
      await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
        name: 'Sin versión',
        accessLevel: 'WORKSPACE_WRITE',
      })
    ).json()) as { id: string };
    await ponerAgente(app.id, plantillaPO);

    await h.db.execute(
      sql`UPDATE documents SET current_version_id = NULL WHERE app_id = ${app.id}::uuid`,
    );

    const res = await estimar(ana, app.id);

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('no committed version');
  });
});

describe('el techo', () => {
  beforeAll(async () => {
    await ponerAgente(appDeAna, plantillaPO);
    await ponerAgente(appDeAna, plantillaDevil);
  });

  it('trae un agente por cada uno que va a intervenir, y la suma', async () => {
    const res = await estimar(ana);
    expect(res.status).toBe(201);

    const techo = (await res.json()) as Techo;
    expect(techo.agents.map((a) => a.handle).sort()).toEqual(['devil', 'po']);
    expect(techo.totalTokens).toBe(
      techo.agents.reduce((suma, uno) => suma + uno.estimatedTokens, 0),
    );
    /* La que se está mirando, no una cualquiera: se revisa la actual (RF-1607). */
    const doc = (await (await h.as(ana).get(`/api/v1/apps/${appDeAna}/document`)).json()) as {
      versionNo: number;
    };
    expect(techo.versionNo).toBe(doc.versionNo);
  });

  it('y es techo: cada agente incluye la salida al máximo que puede generar', async () => {
    /*
     * Lo que hace útil a la cifra es que se pase de larga (RF-1207). Con el
     * proveedor de mentira la entrada son unos cientos de tokens, así que si el
     * número no lleva dentro el techo de salida se queda en nada.
     */
    const techo = (await (await estimar(ana)).json()) as Techo;

    for (const agente of techo.agents) {
      expect(agente.estimatedTokens).toBeGreaterThan(1_000);
    }
  });

  it('un agente pausado no cuenta, porque no va a intervenir', async () => {
    const agentes = (await (await h.as(ana).get(`/api/v1/apps/${appDeAna}/agents`)).json()) as {
      id: string;
      handle: string;
    }[];
    const devil = agentes.find((a) => a.handle === 'devil')!;

    await h.as(ana).patch(`/api/v1/apps/${appDeAna}/agents/${devil.id}`, { active: false });
    const techo = (await (await estimar(ana)).json()) as Techo;

    expect(techo.agents.map((a) => a.handle)).toEqual(['po']);

    await h.as(ana).patch(`/api/v1/apps/${appDeAna}/agents/${devil.id}`, { active: true });
  });
});

describe('quién puede pedirlo', () => {
  it('quien solo lee la app: pedir que te lean no cambia nada del documento', async () => {
    /* La regla que se sale de lo habitual (RF-1608, D-12). */
    const res = await estimar(bruno);

    expect(res.status).toBe(201);
  });

  it('un extraño ni siquiera sabe que la app existe', async () => {
    const res = await estimar(carla);

    expect(res.status).toBe(404);
  });
});

describe('el cupo', () => {
  it('dice cuánto queda y si cabe', async () => {
    const techo = (await (await estimar(ana)).json()) as Techo;

    /* Sin cupo puesto no hay techo que romper, así que cabe (RF-1204). */
    expect(techo.remainingTokens).toBeNull();
    expect(techo.fitsInQuota).toBe(true);
  });

  it('con un cupo por debajo de lo que costaría, avisa de que no cabe', async () => {
    const antes = (await (await estimar(ana)).json()) as Techo;

    await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC/quota`, {
      monthlyTokenQuota: Math.floor(antes.totalTokens / 2),
    });

    const techo = (await (await estimar(ana)).json()) as Techo;
    expect(techo.fitsInQuota).toBe(false);
    expect(techo.remainingTokens).toBeLessThan(techo.totalTokens);

    await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC/quota`, {});
  });
});

describe('lanzar la revisión', () => {
  it('crea una ejecución por agente y la deja encolada', async () => {
    const res = await h.as(ana).post(`/api/v1/apps/${appDeAna}/reviews`, {});
    expect(res.status).toBe(201);

    const revision = (await res.json()) as {
      id: string;
      status: string;
      runs: { handle: string; status: string }[];
      done: number;
      estimatedTokens: number;
      canCancel: boolean;
    };

    expect(revision.status).toBe('QUEUED');
    expect(revision.runs.map((r) => r.handle).sort()).toEqual(['devil', 'po']);
    expect(revision.done).toBe(0);
    expect(revision.estimatedTokens).toBeGreaterThan(0);
    expect(revision.canCancel).toBe(true);
  });

  it('y mientras esa siga viva no se puede lanzar otra', async () => {
    /*
     * Lo dice el motor, no una consulta previa: el único parcial es lo que
     * hace imposible pagar dos revisiones del mismo documento (RF-1609).
     */
    const res = await h.as(ana).post(`/api/v1/apps/${appDeAna}/reviews`, {});

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('already a review running');
  });

  it('la ve cualquiera que vea la app, con su progreso', async () => {
    const res = await h.as(bruno).get(`/api/v1/apps/${appDeAna}/reviews/current`);
    const revision = (await res.json()) as { status: string; canCancel: boolean; done: number };

    expect(revision.status).toBe('QUEUED');
    expect(revision.done).toBe(0);
    /* Verla no es poder pararla: Bruno ni la pidió ni es el precursor. */
    expect(revision.canCancel).toBe(false);
  });

  it('y un extraño no la ve, como no ve la app', async () => {
    const res = await h.as(carla).get(`/api/v1/apps/${appDeAna}/reviews/current`);

    expect(res.status).toBe(404);
  });
});

describe('pararla a media', () => {
  it('un miembro que no la pidió no puede', async () => {
    const actual = (await (
      await h.as(ana).get(`/api/v1/apps/${appDeAna}/reviews/current`)
    ).json()) as { id: string };

    const res = await h.as(bruno).delete(`/api/v1/apps/${appDeAna}/reviews/${actual.id}`);

    expect(res.status).toBe(403);
  });

  it('quien la pidió, sí, y lo pendiente se cierra con ella', async () => {
    const actual = (await (
      await h.as(ana).get(`/api/v1/apps/${appDeAna}/reviews/current`)
    ).json()) as { id: string };

    const res = await h.as(ana).delete(`/api/v1/apps/${appDeAna}/reviews/${actual.id}`);
    expect(res.status).toBe(200);

    const parada = (await res.json()) as { status: string; runs: { status: string }[] };
    expect(parada.status).toBe('CANCELLED');
    expect(parada.runs.every((r) => r.status === 'CANCELLED')).toBe(true);
  });

  it('y una que ya está parada no se para dos veces', async () => {
    const actual = (await (
      await h.as(ana).get(`/api/v1/apps/${appDeAna}/reviews/current`)
    ).json()) as { id: string };

    const res = await h.as(ana).delete(`/api/v1/apps/${appDeAna}/reviews/${actual.id}`);

    expect(res.status).toBe(409);
  });

  it('con la anterior cerrada, se puede volver a pedir', async () => {
    const res = await h.as(ana).post(`/api/v1/apps/${appDeAna}/reviews`, {});

    expect(res.status).toBe(201);

    /* Se deja parada para no dejar trabajo suelto en la cola de los tests. */
    const nueva = (await res.json()) as { id: string };
    await h.as(ana).delete(`/api/v1/apps/${appDeAna}/reviews/${nueva.id}`);
  });
});

describe('el rastro', () => {
  it('la auditoría registra que se pidió y que se paró, sin nada del documento', async () => {
    const cuerpo = await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/audit`)
    ).text();

    expect(cuerpo).toContain('ai.review_requested');
    expect(cuerpo).toContain('ai.review_cancelled');
    expect(cuerpo).not.toContain('Apuntar una idea cuesta');
  });
});
