import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeProvider, type ProviderRegistry } from '@app-foundry/ai';
import { AiProvider } from '@app-foundry/core';
import { aiInvocations } from '@app-foundry/db';

import { AI_REGISTRY } from '../src/ai/ai.tokens.js';
import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Generación de ideas, de la petición al registro (RF-1301..1307).
 *
 * Los dos proveedores de mentira se distinguen en una cosa a propósito: uno
 * busca en la web y el otro no. Es lo que permite recorrer las dos ramas —ideas
 * fundamentadas y ideas que dicen no estarlo— por el camino real.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let conBusqueda: FakeProvider;
let sinBusqueda: FakeProvider;

interface Evento {
  type: string;
  [campo: string]: unknown;
}

const PROPUESTA = {
  name: 'Rutas',
  problem: 'Nadie sabe cuando pasa el autobus.',
  audience: 'Quien lo coge a diario.',
  valueProposition: 'Llegadas reales.',
  monetisation: 'FREEMIUM',
  effort: 'un par de meses',
  mainRisk: 'Que no haya datos abiertos.',
  tags: ['transporte'],
  shortDescription: 'Llegadas de autobus de verdad.',
};

const tanda = (cuantas: number) => ({
  proposals: Array.from({ length: cuantas }, (_, i) => ({
    ...PROPUESTA,
    name: `${PROPUESTA.name} ${String(i + 1)}`,
  })),
});

async function pedir(quien: TestUser, cuerpo: Record<string, unknown> = {}) {
  const response = await h.as(quien).post(`/api/v1/workspaces/${ana.workspaceId}/ai/ideas`, cuerpo);
  const texto = await response.text();
  const eventos = texto
    .split('\n\n')
    .map((bloque) => /^data: (.*)$/m.exec(bloque)?.[1])
    .filter((d): d is string => d !== undefined)
    .map((d) => JSON.parse(d) as Evento);
  return { status: response.status, eventos, cuerpo: texto };
}

const propuestasDe = (eventos: Evento[]) =>
  eventos.filter((e) => e.type === 'proposal').map((e) => e['proposal'] as { name: string });

const meta = (eventos: Evento[]) => eventos.find((e) => e.type === 'meta');

async function invocaciones(cuantas: number) {
  return h.db
    .select()
    .from(aiInvocations)
    .where(eq(aiInvocations.workspaceId, ana.workspaceId))
    .orderBy(desc(aiInvocations.id))
    .limit(cuantas);
}

/** Deja `IDEA_GENERATION` en manos del proveedor que toque. */
async function asignarA(provider: 'ANTHROPIC' | 'GROQ') {
  const modelos = (await (
    await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/models`)
  ).json()) as { id: string; provider: string }[];
  const modelo = modelos.find((m) => m.provider === provider) ?? modelos[0]!;
  await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/tasks/IDEA_GENERATION`, {
    provider,
    modelId: modelo.id,
  });
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');

  const registro = h.resolve<ProviderRegistry>(AI_REGISTRY);
  conBusqueda = registro.get(AiProvider.ANTHROPIC) as FakeProvider;
  sinBusqueda = registro.get(AiProvider.GROQ) as FakeProvider;

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
  for (const provider of ['ANTHROPIC', 'GROQ']) {
    await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/${provider}`, {
      apiKey: `sk-de-mentira-${provider.toLowerCase()}`,
    });
  }
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('con un modelo que sabe buscar', () => {
  beforeAll(async () => {
    await asignarA('ANTHROPIC');
  });

  it('las propuestas llegan de una en una, no en bloque', async () => {
    conBusqueda.program({
      object: tanda(4),
      sources: [{ url: 'https://x.test', title: 'Un dato' }],
    });

    const { status, eventos } = await pedir(ana, { topic: 'transporte urbano' });

    expect(status).toBe(200);
    expect(propuestasDe(eventos).map((p) => p.name)).toEqual([
      'Rutas 1',
      'Rutas 2',
      'Rutas 3',
      'Rutas 4',
    ]);
    expect(eventos.at(-1)).toMatchObject({ type: 'done', count: 4 });
  });

  /*
   * Investigar y dar forma son dos llamadas (T-25), y por tanto dos consumos de
   * tokens. Contarlas como una sería mentir sobre lo que cuesta esta función.
   */
  it('son dos invocaciones, y las dos quedan registradas', async () => {
    conBusqueda.program({ object: tanda(3) });
    await pedir(ana, { topic: 'cocina' });

    const dos = await invocaciones(2);
    expect(dos).toHaveLength(2);
    expect(dos.every((f) => f.task === 'IDEA_GENERATION' && f.outcome === 'COMPLETED')).toBe(true);
  });

  it('lo encontrado viaja con sus fuentes, y se dice que está fundamentado', async () => {
    conBusqueda.program({
      object: tanda(3),
      sources: [{ url: 'https://fuente.test/a', title: 'Un informe' }],
    });

    const { eventos } = await pedir(ana, {});

    expect(meta(eventos)?.['grounded']).toBe(true);
    const fuentes = eventos.find((e) => e.type === 'sources');
    expect(fuentes?.['sources']).toEqual([{ url: 'https://fuente.test/a', title: 'Un informe' }]);
  });

  /*
   * El modelo no recuerda la tanda anterior: pedirle variedad sin decirle de qué
   * produce las mismas ideas con otras palabras (RF-1307). Se comprueba que lo
   * excluido sale de verdad hacia el proveedor, mirando cuánto se le manda.
   */
  it('otra tanda manda al proveedor lo que ya se enseñó', async () => {
    conBusqueda.program({ object: tanda(3) });
    await pedir(ana, { topic: 'igual' });
    const sinExcluir = conBusqueda.calls.filter((c) => c.operation === 'streamObject')[0]!;

    conBusqueda.program({ object: tanda(3) });
    await pedir(ana, { topic: 'igual', exclude: ['Rutas 1', 'Rutas 2', 'Rutas 3'] });
    const conExcluir = conBusqueda.calls.filter((c) => c.operation === 'streamObject')[0]!;

    expect(conExcluir.inputChars).toBeGreaterThan(sinExcluir.inputChars);
  });
});

describe('con un modelo que no sabe buscar', () => {
  beforeAll(async () => {
    await asignarA('GROQ');
  });

  /*
   * La línea que no se cruza (RF-1305): lo que sale del conocimiento del modelo
   * se marca como tal. Una propuesta que aparenta estar respaldada por datos es
   * peor que ninguna, porque se decide sobre ella creyendo que los hay.
   */
  it('se dice que no está fundamentado, y no se inventan fuentes', async () => {
    sinBusqueda.program({ object: tanda(3) });

    const { eventos } = await pedir(ana, { topic: 'lo que sea' });

    expect(meta(eventos)?.['grounded']).toBe(false);
    expect(eventos.some((e) => e.type === 'sources')).toBe(false);
    expect(propuestasDe(eventos)).toHaveLength(3);
  });

  /* Sin búsqueda no hay fase de investigación: una sola llamada y una sola fila. */
  it('es una sola invocación', async () => {
    sinBusqueda.program({ object: tanda(3) });
    const antes = (await invocaciones(1))[0];

    await pedir(ana, {});

    const [ultima, penultima] = await invocaciones(2);
    expect(ultima?.outcome).toBe('COMPLETED');
    expect(penultima?.id).toBe(antes?.id);
  });
});

describe('sin restricciones y sin permiso', () => {
  beforeAll(async () => {
    await asignarA('GROQ');
  });

  /* Sin rellenar nada se propone igual: es el caso de quien no sabe qué construir. */
  it('sin rellenar nada, se propone igual', async () => {
    sinBusqueda.program({ object: tanda(3) });

    const { status, eventos } = await pedir(ana, {});

    expect(status).toBe(200);
    expect(propuestasDe(eventos)).toHaveLength(3);
  });

  it('quien no es del workspace no genera nada', async () => {
    const { status } = await pedir(bruno, {});

    expect(status).toBe(403);
  });
});
