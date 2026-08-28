import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sessions, users } from '../src/index.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';

/** Extrae el SQLSTATE de un error de Postgres, venga envuelto o no. */
function sqlstateDe(error: unknown): string | undefined {
  let actual: unknown = error;
  while (actual instanceof Error) {
    const code = (actual as Error & { code?: string }).code;
    if (typeof code === 'string') return code;
    actual = actual.cause;
  }
  return undefined;
}

let testDb: TestDb;
let ana: string;
let bruno: string;

beforeAll(async () => {
  testDb = await startTestDb();

  // El seed se hace como superusuario, que siempre ignora RLS: es la forma de
  // preparar el escenario sin que las políticas estorben.
  const [a] = await testDb.db
    .insert(users)
    .values({ githubId: 1001, handle: 'ana', email: 'ana@example.com', displayName: 'Ana' })
    .returning({ id: users.id });
  const [b] = await testDb.db
    .insert(users)
    .values({ githubId: 1002, handle: 'bruno', email: 'bruno@example.com', displayName: 'Bruno' })
    .returning({ id: users.id });

  ana = a!.id;
  bruno = b!.id;

  const enUnaHora = new Date(Date.now() + 3_600_000);
  await testDb.db.insert(sessions).values([
    { userId: ana, tokenHash: 'hash-de-ana', expiresAt: enUnaHora },
    { userId: bruno, tokenHash: 'hash-de-bruno', expiresAt: enUnaHora },
  ]);
});

afterAll(async () => {
  await testDb?.stop();
});

/**
 * Meta-comprobaciones.
 *
 * Si el rol de la aplicación pudiera saltarse RLS, todo lo demás de este
 * fichero pasaría sin probar nada. Se verifica primero.
 */
describe('el canario: el propio montaje del aislamiento', () => {
  it('app_user no es superusuario ni puede saltarse RLS', async () => {
    const result = await testDb.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`,
    );
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('las tablas tienen RLS activada y forzada', async () => {
    const result = await testDb.db.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      sql`SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_class WHERE relname IN ('users', 'sessions') ORDER BY relname`,
    );
    expect(result.rows).toEqual([
      { relname: 'sessions', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'users', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it('current_app_user() devuelve NULL cuando no hay contexto', async () => {
    const result = await asAppUser(testDb.db, null, (tx) =>
      tx.execute<{ uid: string | null }>(sql`SELECT current_app_user() AS uid`),
    );
    expect(result.rows[0]?.uid).toBeNull();
  });
});

describe('aislamiento entre usuarios', () => {
  it('cada uno ve solo sus propias sesiones', async () => {
    const deAna = await asAppUser(testDb.db, ana, (tx) => tx.select().from(sessions));
    expect(deAna.map((s) => s.tokenHash)).toEqual(['hash-de-ana']);

    const deBruno = await asAppUser(testDb.db, bruno, (tx) => tx.select().from(sessions));
    expect(deBruno.map((s) => s.tokenHash)).toEqual(['hash-de-bruno']);
  });

  it('sin identidad no se ve nada: el defecto es no ver', async () => {
    const filas = await asAppUser(testDb.db, null, (tx) => tx.select().from(sessions));
    expect(filas).toHaveLength(0);
  });

  it('cada uno se ve a sí mismo y no a los demás', async () => {
    const vistos = await asAppUser(testDb.db, ana, (tx) => tx.select().from(users));
    expect(vistos.map((u) => u.handle)).toEqual(['ana']);
  });

  it('un identificador ajeno no abre la puerta: filtrar por él no devuelve nada', async () => {
    const filas = await asAppUser(testDb.db, ana, (tx) =>
      tx.execute(sql`SELECT * FROM sessions WHERE user_id = ${bruno}`),
    );
    expect(filas.rows).toHaveLength(0);
  });
});

describe('la política también protege las escrituras', () => {
  it('no se puede crear una sesión a nombre de otro', async () => {
    const error = await asAppUser(testDb.db, ana, (tx) =>
      tx
        .insert(sessions)
        .values({
          userId: bruno,
          tokenHash: 'hash-falsificado',
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .then(
          () => null,
          (e: unknown) => e,
        ),
    );

    // Se comprueba el SQLSTATE y no el texto del mensaje: 42501 es
    // insufficient_privilege, que es como Postgres rechaza una escritura que
    // incumple el WITH CHECK de una política. El texto depende del idioma del
    // servidor y Drizzle además lo envuelve.
    expect(sqlstateDe(error)).toBe('42501');
  });

  it('no se puede borrar la sesión de otro: la orden pasa, pero no toca nada', async () => {
    await asAppUser(testDb.db, ana, (tx) =>
      tx.execute(sql`DELETE FROM sessions WHERE token_hash = 'hash-de-bruno'`),
    );
    const siguenAmbas = await testDb.db.select().from(sessions);
    expect(siguenAmbas.map((s) => s.tokenHash).sort()).toEqual(['hash-de-ana', 'hash-de-bruno']);
  });

  it('nadie puede tocar el rol de plataforma, ni el propio ni el ajeno', async () => {
    // Desde H1 el permiso de UPDATE sobre users se concede por columna y no
    // incluye platform_role, así que Postgres rechaza la sentencia entera.
    // Los casos completos viven en workspace-rls.test.ts.
    for (const objetivo of [ana, bruno]) {
      const error = await asAppUser(testDb.db, ana, (tx) =>
        tx.execute(sql`UPDATE users SET platform_role = 'ADMIN' WHERE id = ${objetivo}`).then(
          () => null,
          (e: unknown) => e,
        ),
      );
      expect(sqlstateDe(error)).toBe('42501');
    }

    const roles = await testDb.db.select({ role: users.platformRole }).from(users);
    expect(roles.every((r) => r.role === 'MEMBER')).toBe(true);
  });
});
