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

  /*
   * Groq garantiza la forma solo en algunos modelos; el resto rechaza el formato
   * de plano. Sin esta salida, «no sé qué construir» dejaba de existir para quien
   * tuviera asignado cualquiera de ellos.
   */
  it('si el modelo no admite esquema, se describe la forma y hay ideas igual', async () => {
    /*
     * Falla la primera vez que se le pide con esquema —la investigación va sin
     * él— y responde a la siguiente, que es la que lleva la forma descrita.
     */
    conBusqueda.program({
      /*
       * Sin esquema, la respuesta llega como texto: es el propio modelo quien
       * escribe el JSON porque se lo pide el encargo, no el proveedor quien lo
       * garantiza. El de mentira devuelve lo mismo por los dos caminos.
       */
      object: tanda(3),
      text: JSON.stringify(tanda(3)),
      failWith: 'SCHEMA',
      failTimes: 2,
    });

    const { status, eventos } = await pedir(ana, { topic: 'algo' });

    expect(status).toBe(200);
    expect(propuestasDe(eventos)).toHaveLength(3);
    expect(eventos.some((e) => e.type === 'error')).toBe(false);
    /* Y la meta sale una sola vez, aunque se haya intentado dos veces. */
    expect(eventos.filter((e) => e.type === 'meta')).toHaveLength(1);

    /*
     * Y se dice: sin la forma garantizada, una propuesta malformada se descarta
     * en silencio y la tanda puede salir más corta de lo pedido.
     */
    expect(eventos.some((e) => e.type === 'notice' && e['code'] === 'SHAPE_NOT_GUARANTEED')).toBe(
      true,
    );
  });

  /*
   * Una investigación sin una sola fuente no fundamenta nada, y darla por buena
   * sería presentar como respaldado lo que no lo está (RF-1305).
   */
  it('sin fuentes no se da por fundamentado, y se dice por qué', async () => {
    conBusqueda.program({ object: tanda(3), sources: [] });

    const { eventos } = await pedir(ana, {});
    const aviso = eventos.find((e) => e.type === 'notice');

    expect(meta(eventos)?.['grounded']).toBe(false);
    expect(aviso?.['code']).toBe('NO_WEB_SEARCH');
    expect(propuestasDe(eventos)).toHaveLength(3);
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
   * Buscar es lo mejor que se puede hacer, no un requisito: la capacidad se
   * declara por proveedor y la realidad es por modelo —Groq ofrece búsqueda web
   * y solo la admiten algunos de sus modelos—. Si la rechaza, se proponen ideas
   * igual **diciendo que no están fundamentadas**, que es justo lo que pide
   * RF-1305. Rendirse dejaba sin función a un modelo perfectamente capaz de
   * proponer.
   */
  it('si la búsqueda se rechaza, hay ideas igual y se dice que no van fundamentadas', async () => {
    /* Falla la primera llamada —la de buscar— y responde la segunda. */
    conBusqueda.program({ object: tanda(3), failWith: 'INVALID_REQUEST', failTimes: 1 });

    const { status, eventos } = await pedir(ana, { topic: 'lo que sea' });

    expect(status).toBe(200);
    expect(meta(eventos)?.['grounded']).toBe(false);
    expect(propuestasDe(eventos)).toHaveLength(3);
    expect(eventos.some((e) => e.type === 'error')).toBe(false);
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

describe('elegir una propuesta', () => {
  const elegir = (quien: TestUser, extra: Record<string, unknown> = {}) =>
    h.as(quien).post(`/api/v1/workspaces/${ana.workspaceId}/ai/ideas/choose`, {
      ...PROPUESTA,
      ...extra,
    });

  it('crea la app con su nombre, su descripción y sus etiquetas', async () => {
    const response = await elegir(ana);
    const app = (await response.json()) as {
      id: string;
      name: string;
      shortDescription: string;
      status: string;
      tags: string[];
    };

    expect(response.status).toBe(201);
    expect(app.name).toBe('Rutas');
    expect(app.shortDescription).toBe(PROPUESTA.shortDescription);
    expect(app.status).toBe('IDEA');
    expect(app.tags).toEqual(['transporte']);
  });

  /*
   * Lo que ha escrito un modelo llega como **borrador**, no como una versión que
   * alguien haya dado por buena: darlo por commiteado sería firmar en nombre de
   * quien todavía no lo ha leído (RF-1308, RF-505).
   */
  it('la visión llega a la copia de trabajo, sin versión y sin commitear', async () => {
    const app = (await (await elegir(ana)).json()) as { id: string };
    const doc = (await (await h.as(ana).get(`/api/v1/apps/${app.id}/document`)).json()) as {
      content: string;
      versionNo: number;
      currentVersionId: string | null;
      uncommittedChanges: boolean;
      aiSeeded: boolean;
    };

    expect(doc.currentVersionId).toBeNull();
    expect(doc.versionNo).toBe(0);
    expect(doc.uncommittedChanges).toBe(true);
    /* Y con la estructura de la plantilla de la v1, con lo suyo contestado. */
    expect(doc.content).toContain('# The problem');
    expect(doc.content).toContain('Nadie sabe cuando pasa el autobus');
    /* Constancia de dónde salió (RF-1311). */
    expect(doc.aiSeeded).toBe(true);
  });

  it('las fuentes, si las hubo, quedan dentro del documento', async () => {
    const app = (await (
      await elegir(ana, { sources: [{ url: 'https://fuente.test/x', title: 'Un informe' }] })
    ).json()) as { id: string };
    const doc = (await (await h.as(ana).get(`/api/v1/apps/${app.id}/document`)).json()) as {
      content: string;
    };

    expect(doc.content).toContain('[Un informe](https://fuente.test/x)');
  });

  /*
   * Crear una app con ayuda de la IA no cambia de quién es ni quién la ve
   * (RF-1310, D-9): pasa por el mismo alta que crearla a mano.
   */
  it('el precursor y el acceso son los de siempre', async () => {
    const app = (await (await elegir(ana)).json()) as { id: string; precursorHandle: string };
    const detalle = (await (await h.as(ana).get(`/api/v1/apps/${app.id}`)).json()) as {
      accessLevel: string;
      precursorHandle: string;
      isPrecursor: boolean;
    };

    expect(detalle.precursorHandle).toBe(ana.handle);
    expect(detalle.isPrecursor).toBe(true);
    expect(detalle.accessLevel).toBe('PRIVATE');
  });

  it('una app creada a mano no dice haber salido de una propuesta', async () => {
    const app = (await (
      await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, { name: 'A mano' })
    ).json()) as { id: string };
    const doc = (await (await h.as(ana).get(`/api/v1/apps/${app.id}/document`)).json()) as {
      aiSeeded: boolean;
      versionNo: number;
    };

    expect(doc.aiSeeded).toBe(false);
    expect(doc.versionNo).toBe(1);
  });

  /*
   * Lo descartado no deja rastro (RF-1312): generar una tanda y no elegir nada
   * no crea apps ni guarda propuestas. Lo único que queda es el registro de la
   * invocación, que es lo que responde «¿en qué se fue la cuota?».
   */
  it('generar sin elegir no deja nada detrás', async () => {
    sinBusqueda.program({ object: tanda(4) });
    const antes = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as { items: unknown[] };

    await pedir(ana, { topic: 'algo que no voy a elegir' });

    const despues = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as { items: unknown[] };
    expect(despues.items).toHaveLength(antes.items.length);
    /* Pero la invocación sí queda: es lo que explica en qué se fue la cuota. */
    expect((await invocaciones(1))[0]?.task).toBe('IDEA_GENERATION');
  });

  it('quien no es del workspace no crea nada', async () => {
    expect((await elegir(bruno)).status).toBe(404);
  });
});
