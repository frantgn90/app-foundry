import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { agentTemplates } from '../src/index.js';
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
beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);
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

describe('lo que arrastra el workspace', () => {
  it('borrarlo se lleva sus plantillas: no son de nadie más', async () => {
    const antes = await db.db.select().from(agentTemplates);
    expect(antes.length).toBeGreaterThan(0);

    await db.db.execute(sql`DELETE FROM workspaces WHERE id = ${e.wsBruno}::uuid`);

    const quedan = await db.db.select().from(agentTemplates);
    expect(quedan.every((p) => p.workspaceId !== e.wsBruno)).toBe(true);
  });
});
