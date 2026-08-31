import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workspaceAiCredentials, workspaceAiProviders } from '../src/index.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';
import { type Scenario, seed } from './scenario.js';

let db: TestDb;
let e: Scenario;

/** El cifrado y su nonce, que aquí no importa qué contengan. */
const CIFRADO = Buffer.from('texto-cifrado-de-mentira');
const NONCE = Buffer.from('123456789012');

async function failure(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * El código de error de Postgres, rescatado de la cadena de causas.
 *
 * Drizzle envuelve el error original con su propio «Failed query», así que
 * mirar el mensaje de fuera no dice nada. `42501` es privilegio insuficiente.
 */
function sqlstateOf(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as Error & { code?: string }).code;
    if (typeof code === 'string') return code;
    current = current.cause;
  }
  return undefined;
}

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  /* Ana configura un proveedor en su workspace. Bruno es miembro; Carla no. */
  await db.db.insert(workspaceAiProviders).values({
    workspaceId: e.wsAna,
    provider: 'ANTHROPIC',
    credentialHint: 'rdad',
    createdBy: e.ana,
  });
  await db.db.insert(workspaceAiCredentials).values({
    workspaceId: e.wsAna,
    provider: 'ANTHROPIC',
    ciphertext: CIFRADO,
    nonce: NONCE,
    keyVersion: 1,
  });
}, 180_000);

afterAll(async () => {
  await db.stop();
});

describe('quién ve la configuración de IA', () => {
  it('un miembro sabe que hay proveedor, aunque no lo haya puesto él', async () => {
    const filas = await asAppUser(db.db, e.bruno, (tx) =>
      tx.select().from(workspaceAiProviders).where(eq(workspaceAiProviders.workspaceId, e.wsAna)),
    );

    /* Sin esto no se podría decidir si enseñar las funciones de IA (RF-1010). */
    expect(filas).toHaveLength(1);
    expect(filas[0]?.status).toBe('ACTIVE');
  });

  it('un extraño no ve nada', async () => {
    const filas = await asAppUser(db.db, e.carla, (tx) => tx.select().from(workspaceAiProviders));

    expect(filas).toHaveLength(0);
  });

  it('sin identidad tampoco se ve nada', async () => {
    const filas = await asAppUser(db.db, null, (tx) => tx.select().from(workspaceAiProviders));

    expect(filas).toHaveLength(0);
  });
});

describe('quién la configura', () => {
  it('un miembro que no es dueño no puede añadir un proveedor', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(workspaceAiProviders).values({
          workspaceId: e.wsAna,
          provider: 'GROQ',
          credentialHint: 'xxxx',
          createdBy: e.bruno,
        }),
      ),
    );

    expect(error).not.toBeNull();
  });

  it('ni cambiarle el cupo al que hay', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .update(workspaceAiProviders)
        .set({ monthlyTokenQuota: 999_999 })
        .where(eq(workspaceAiProviders.workspaceId, e.wsAna)),
    );

    const [fila] = await db.db
      .select()
      .from(workspaceAiProviders)
      .where(eq(workspaceAiProviders.workspaceId, e.wsAna));

    /* La política no rechaza el UPDATE: no encuentra fila que actualizar. */
    expect(fila?.monthlyTokenQuota).toBeNull();
  });

  it('el dueño sí', async () => {
    await asAppUser(db.db, e.ana, (tx) =>
      tx
        .update(workspaceAiProviders)
        .set({ monthlyTokenQuota: 1_000_000 })
        .where(eq(workspaceAiProviders.workspaceId, e.wsAna)),
    );

    const [fila] = await db.db
      .select()
      .from(workspaceAiProviders)
      .where(eq(workspaceAiProviders.workspaceId, e.wsAna));

    expect(fila?.monthlyTokenQuota).toBe(1_000_000);
  });

  it('el dueño no puede configurar el workspace de otro', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(workspaceAiProviders).values({
          workspaceId: e.wsBruno,
          provider: 'GROQ',
          credentialHint: 'xxxx',
          createdBy: e.ana,
        }),
      ),
    );

    expect(error).not.toBeNull();
  });
});

describe('el secreto', () => {
  /*
   * La comprobación que sostiene RNF-603: ni siquiera su dueño puede leer el
   * texto cifrado con el rol de la aplicación. No lo impide una política sino
   * la ausencia de permiso sobre esas dos columnas (AP3).
   */
  it('nadie lo lee directamente, tampoco el dueño', async () => {
    for (const quien of [e.ana, e.bruno, e.carla]) {
      const error = await failure(() =>
        asAppUser(db.db, quien, (tx) =>
          tx.execute(sql`SELECT ciphertext FROM workspace_ai_credentials`),
        ),
      );

      expect(sqlstateOf(error)).toBe('42501');
    }
  });

  it('lo que no es secreto sí se puede leer, y hace falta para actualizar', async () => {
    const filas = await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`SELECT workspace_id, provider, key_version FROM workspace_ai_credentials`),
    );

    expect(filas.rows).toHaveLength(1);
  });

  it('un miembro no dueño no puede escribirlo', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(workspaceAiCredentials).values({
          workspaceId: e.wsAna,
          provider: 'GROQ',
          ciphertext: CIFRADO,
          nonce: NONCE,
          keyVersion: 1,
        }),
      ),
    );

    expect(error).not.toBeNull();
  });
});

describe('la única puerta al secreto', () => {
  const leer = (quien: string | null) =>
    asAppUser(db.db, quien, (tx) =>
      tx.execute(sql`SELECT * FROM ai_credential_secret(${e.wsAna}::uuid, 'ANTHROPIC')`),
    );

  it('se lo devuelve al dueño', async () => {
    const filas = await leer(e.ana);

    expect(filas.rows).toHaveLength(1);
    expect(filas.rows[0]?.['key_version']).toBe(1);
  });

  /*
   * A cualquier miembro, no solo al dueño: quien menciona a un agente o pide
   * que le mejoren un párrafo provoca una invocación, y la atiende la
   * credencial del dueño.
   */
  it('y a cualquier miembro, porque cualquiera puede provocar una invocación', async () => {
    expect((await leer(e.bruno)).rows).toHaveLength(1);
  });

  it('a un extraño no le devuelve nada, aunque acierte el identificador', async () => {
    expect((await leer(e.carla)).rows).toHaveLength(0);
  });

  it('sin identidad, nada', async () => {
    expect((await leer(null)).rows).toHaveLength(0);
  });

  it('un proveedor desactivado no entrega su secreto ni por descuido', async () => {
    await db.db
      .update(workspaceAiProviders)
      .set({ status: 'DISABLED' })
      .where(eq(workspaceAiProviders.workspaceId, e.wsAna));

    expect((await leer(e.ana)).rows).toHaveLength(0);

    await db.db
      .update(workspaceAiProviders)
      .set({ status: 'ACTIVE' })
      .where(eq(workspaceAiProviders.workspaceId, e.wsAna));
  });
});
