import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agents, agentTemplates, apps } from '../src/index.js';
import { startTestDb, type TestDb } from './helpers.js';
import { type Scenario, seed } from './scenario.js';

let db: TestDb;
let e: Scenario;

/**
 * Lo que el motor garantiza de las plantillas, ejercitado contra un Postgres de
 * verdad.
 *
 * Aquí no se prueba quién puede hacer qué —eso es aislamiento, y llega con su
 * propia migración—: se prueba la **forma**, que es lo que esta migración
 * promete. Se siembra como superusuario, igual que el resto del escenario, para
 * que ninguna política estorbe a lo que se quiere medir.
 */
/** Una app de Ana y otra de Bruno, para cruzar workspaces cuando haga falta. */
let appAna: string;
let appBruno: string;

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  const [deAna] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug: 'vision',
      name: 'Visión',
      precursorId: e.ana,
      accessLevel: 'WORKSPACE_READ',
      iconEmoji: '💡',
      iconColor: 'teal',
    })
    .returning({ id: apps.id });
  appAna = deAna!.id;

  const [deBruno] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsBruno,
      slug: 'ajena',
      name: 'Ajena',
      precursorId: e.bruno,
      accessLevel: 'WORKSPACE_READ',
      iconEmoji: '📦',
      iconColor: 'slate',
    })
    .returning({ id: apps.id });
  appBruno = deBruno!.id;
}, 180_000);

afterAll(async () => {
  await db.stop();
});

/** Una plantilla mínima, con lo obligatorio y nada más. */
function plantilla(workspaceId: string, handle: string) {
  return {
    workspaceId,
    name: 'Tech Lead',
    handle,
    iconEmoji: '🛠️',
    iconColor: 'slate',
    prompt: 'Judge whether this can actually be built.',
    createdBy: e.ana,
  };
}

/** Un agente mínimo, sin molde: instanciar desde uno se prueba aparte. */
function agente(appId: string, handle: string) {
  return {
    appId,
    name: 'Product Owner',
    handle,
    iconEmoji: '🎯',
    iconColor: 'amber',
    addedBy: e.ana,
  };
}

/** El mensaje del error de Postgres, que Drizzle envuelve en su «Failed query». */
function mensajeDe(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = actual.cause;
  }
  return partes.join(' | ');
}

async function fallo(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

describe('el handle de una plantilla', () => {
  it('no se repite dentro del mismo workspace', async () => {
    await db.db.insert(agentTemplates).values(plantilla(e.wsAna, 'techlead'));

    const error = await fallo(() =>
      db.db.insert(agentTemplates).values(plantilla(e.wsAna, 'techlead')),
    );
    expect(error).not.toBeNull();
  });

  it('no distingue mayúsculas: `@TechLead` llama al mismo de siempre', async () => {
    const error = await fallo(() =>
      db.db.insert(agentTemplates).values(plantilla(e.wsAna, 'TechLead')),
    );
    expect(error).not.toBeNull();
  });

  it('sí se repite entre workspaces distintos, que no se conocen', async () => {
    await expect(
      db.db.insert(agentTemplates).values(plantilla(e.wsBruno, 'techlead')),
    ).resolves.not.toThrow();
  });
});

describe('el modelo propio', () => {
  it('se puede omitir, y entonces manda el asignado a la tarea', async () => {
    await expect(
      db.db.insert(agentTemplates).values(plantilla(e.wsAna, 'sin-modelo')),
    ).resolves.not.toThrow();
  });

  it('se puede fijar entero', async () => {
    await expect(
      db.db.insert(agentTemplates).values({
        ...plantilla(e.wsAna, 'con-modelo'),
        provider: 'ANTHROPIC',
        modelId: 'claude-opus-5',
      }),
    ).resolves.not.toThrow();
  });

  it('no se puede fijar a medias: un proveedor sin modelo no dice cuál', async () => {
    const error = await fallo(() =>
      db.db.insert(agentTemplates).values({
        ...plantilla(e.wsAna, 'medio-modelo'),
        provider: 'ANTHROPIC',
      }),
    );
    expect(error).not.toBeNull();
  });

  it('ni al revés: un modelo sin proveedor no identifica a nadie', async () => {
    const error = await fallo(() =>
      db.db.insert(agentTemplates).values({
        ...plantilla(e.wsAna, 'modelo-huerfano'),
        modelId: 'claude-opus-5',
      }),
    );
    expect(error).not.toBeNull();
  });
});

describe('el handle de un agente', () => {
  it('no se repite entre los que siguen en la app', async () => {
    await db.db.insert(agents).values(agente(appAna, 'po'));

    const error = await fallo(() => db.db.insert(agents).values(agente(appAna, 'po')));
    expect(error).not.toBeNull();
  });

  it('tampoco cambiando las mayúsculas', async () => {
    const error = await fallo(() => db.db.insert(agents).values(agente(appAna, 'PO')));
    expect(error).not.toBeNull();
  });

  it('se libera al retirarlo, en vez de quedar quemado para siempre', async () => {
    await db.db
      .update(agents)
      .set({ removedAt: new Date() })
      .where(and(eq(agents.appId, appAna), eq(agents.handle, 'po')));

    await expect(db.db.insert(agents).values(agente(appAna, 'po'))).resolves.not.toThrow();
  });

  it('y el retirado sigue ahí, con su nombre, para lo que escribiera', async () => {
    const retirados = await db.db
      .select()
      .from(agents)
      .where(and(eq(agents.appId, appAna), isNotNull(agents.removedAt)));
    expect(retirados).toHaveLength(1);
    expect(retirados[0]!.handle).toBe('po');
  });

  it('se repite sin problema en otra app: cada una tiene los suyos', async () => {
    await expect(db.db.insert(agents).values(agente(appBruno, 'po'))).resolves.not.toThrow();
  });
});

describe('de qué plantilla desciende', () => {
  it('de una de su propio workspace, sí', async () => {
    const [plantillaAna] = await db.db
      .insert(agentTemplates)
      .values(plantilla(e.wsAna, 'para-instanciar'))
      .returning({ id: agentTemplates.id });

    await expect(
      db.db.insert(agents).values({ ...agente(appAna, 'con-molde'), templateId: plantillaAna!.id }),
    ).resolves.not.toThrow();
  });

  it('de una de otro workspace, no, aunque se acierte el identificador', async () => {
    const [plantillaBruno] = await db.db
      .insert(agentTemplates)
      .values(plantilla(e.wsBruno, 'ajena'))
      .returning({ id: agentTemplates.id });

    const error = await fallo(() =>
      db.db
        .insert(agents)
        .values({ ...agente(appAna, 'molde-ajeno'), templateId: plantillaBruno!.id }),
    );
    /*
     * Se mira el mensaje y no solo que haya fallado: sin esto, el test pasaría
     * igual si lo rechazara cualquier otra cosa —una clave ajena, un único— y
     * dejaría de probar lo que dice probar.
     */
    expect(mensajeDe(error)).toContain('another workspace template');
  });

  it('borrar la plantilla deja al agente sin molde, pero no se lo lleva', async () => {
    const [molde] = await db.db
      .insert(agentTemplates)
      .values(plantilla(e.wsAna, 'efimera'))
      .returning({ id: agentTemplates.id });
    await db.db.insert(agents).values({ ...agente(appAna, 'huerfano'), templateId: molde!.id });

    await db.db.delete(agentTemplates).where(eq(agentTemplates.id, molde!.id));

    const [sobrevive] = await db.db
      .select()
      .from(agents)
      .where(and(eq(agents.appId, appAna), eq(agents.handle, 'huerfano')));
    expect(sobrevive).toBeDefined();
    expect(sobrevive!.templateId).toBeNull();
  });
});

describe('lo que arrastra el workspace', () => {
  it('borrarlo se lleva sus plantillas y sus agentes: no son de nadie más', async () => {
    expect((await db.db.select().from(agentTemplates)).length).toBeGreaterThan(0);
    expect((await db.db.select().from(agents)).length).toBeGreaterThan(0);

    await db.db.execute(sql`DELETE FROM workspaces WHERE id = ${e.wsBruno}::uuid`);

    const plantillas = await db.db.select().from(agentTemplates);
    expect(plantillas.every((p) => p.workspaceId !== e.wsBruno)).toBe(true);

    const quedan = await db.db.select().from(agents);
    expect(quedan.every((a) => a.appId !== appBruno)).toBe(true);
  });
});
