import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { users, workspaceInvitations, workspaceMembers, workspaces } from '../src/index.js';
import { type Escenario, sembrar } from './escenario.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let e: Escenario;

/** SQLSTATE del error, venga envuelto o no. */
function sqlstateDe(error: unknown): string | undefined {
  let actual: unknown = error;
  while (actual instanceof Error) {
    const code = (actual as Error & { code?: string }).code;
    if (typeof code === 'string') return code;
    actual = actual.cause;
  }
  return undefined;
}

/** Ejecuta capturando el error en lugar de propagarlo. */
async function fallo(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  db = await startTestDb();
  e = await sembrar(db.db);
});

afterAll(async () => {
  await db?.stop();
});

describe('quién ve qué workspaces', () => {
  it('cada uno ve aquellos a los que pertenece', async () => {
    const deAna = await asAppUser(db.db, e.ana, (tx) => tx.select().from(workspaces));
    expect(deAna.map((w) => w.slug)).toEqual(['ana']);

    // Bruno es dueño del suyo e invitado en el de Ana: ve los dos.
    const deBruno = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(workspaces));
    expect(deBruno.map((w) => w.slug).sort()).toEqual(['ana', 'bruno']);
  });

  it('quien no pertenece a ninguno no ve nada', async () => {
    const deCarla = await asAppUser(db.db, e.carla, (tx) => tx.select().from(workspaces));
    expect(deCarla).toHaveLength(0);
  });

  it('conocer el identificador de un workspace ajeno no da acceso', async () => {
    const filas = await asAppUser(db.db, e.carla, (tx) =>
      tx.execute(sql`SELECT * FROM workspaces WHERE id = ${e.wsAna}`),
    );
    expect(filas.rows).toHaveLength(0);
  });

  it('solo el dueño puede renombrar el suyo', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(sql`UPDATE workspaces SET name = 'Secuestrado' WHERE id = ${e.wsAna}`),
    );
    const [ws] = await db.db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(sql`${workspaces.id} = ${e.wsAna}`);
    expect(ws?.name).toBe('Workspace de Ana');
  });

  it('no se puede crear un workspace a nombre de otro', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.carla, (tx) =>
        tx.insert(workspaces).values({ ownerId: e.ana, name: 'Impostor', slug: 'impostor' }),
      ),
    );
    expect(sqlstateDe(error)).toBe('42501');
  });
});

describe('miembros de un workspace', () => {
  it('se ven los miembros de los workspaces propios', async () => {
    const vistos = await asAppUser(db.db, e.ana, (tx) => tx.select().from(workspaceMembers));
    expect(vistos.map((m) => m.workspaceId)).toEqual([e.wsAna, e.wsAna]);
  });

  it('un extraño no ve ninguna membresía', async () => {
    const vistos = await asAppUser(db.db, e.carla, (tx) => tx.select().from(workspaceMembers));
    expect(vistos).toHaveLength(0);
  });

  it('un invitado no puede añadir miembros al workspace ajeno', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(workspaceMembers).values({
          workspaceId: e.wsAna,
          userId: e.carla,
          role: 'MEMBER',
        }),
      ),
    );
    expect(sqlstateDe(error)).toBe('42501');
  });

  it('un invitado no puede expulsar a otro', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(
        sql`DELETE FROM workspace_members WHERE workspace_id = ${e.wsAna} AND user_id = ${e.ana}`,
      ),
    );
    const siguen = await db.db
      .select()
      .from(workspaceMembers)
      .where(sql`${workspaceMembers.workspaceId} = ${e.wsAna}`);
    expect(siguen).toHaveLength(2);
  });
});

describe('ver a otras personas', () => {
  it('se ve a quienes comparten workspace', async () => {
    const vistos = await asAppUser(db.db, e.ana, (tx) => tx.select().from(users));
    expect(vistos.map((u) => u.handle).sort()).toEqual(['ana', 'bruno']);
  });

  it('no se ve a quien no comparte ningún workspace', async () => {
    const vistos = await asAppUser(db.db, e.carla, (tx) => tx.select().from(users));
    expect(vistos.map((u) => u.handle)).toEqual(['carla']);
  });

  it('buscar por handle a un desconocido no lo revela', async () => {
    const filas = await asAppUser(db.db, e.carla, (tx) =>
      tx.execute(sql`SELECT id FROM users WHERE handle = 'ana'`),
    );
    expect(filas.rows).toHaveLength(0);
  });
});

describe('invitaciones', () => {
  it('el dueño ve las invitaciones pendientes de su workspace', async () => {
    const vistas = await asAppUser(db.db, e.ana, (tx) => tx.select().from(workspaceInvitations));
    expect(vistas.map((i) => i.email)).toEqual(['daniela@example.com']);
  });

  it('un invitado del workspace no ve sus invitaciones', async () => {
    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(workspaceInvitations));
    expect(vistas).toHaveLength(0);
  });

  it('nadie puede invitar a un workspace que no es suyo', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(workspaceInvitations).values({
          workspaceId: e.wsAna,
          email: 'colado@example.com',
          invitedBy: e.bruno,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    );
    expect(sqlstateDe(error)).toBe('42501');
  });

  it('el email de una invitación compara sin distinguir mayúsculas', async () => {
    const filas = await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`SELECT id FROM workspace_invitations WHERE email = 'Daniela@Example.com'`),
    );
    expect(filas.rows).toHaveLength(1);
  });
});

describe('la deuda que dejó H0: ascenso a ADMIN', () => {
  it('un usuario ya NO puede ascenderse a sí mismo', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.execute(sql`UPDATE users SET platform_role = 'ADMIN' WHERE id = ${e.ana}`),
      ),
    );
    // 42501: el permiso de UPDATE sobre users no incluye esa columna.
    expect(sqlstateDe(error)).toBe('42501');

    const [ana] = await db.db
      .select({ role: users.platformRole })
      .from(users)
      .where(sql`${users.id} = ${e.ana}`);
    expect(ana?.role).toBe('MEMBER');
  });

  it('tampoco puede reactivarse tras ser desactivado', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.execute(sql`UPDATE users SET status = 'ACTIVE' WHERE id = ${e.ana}`),
      ),
    );
    expect(sqlstateDe(error)).toBe('42501');
  });

  it('pero sí puede cambiar su nombre visible', async () => {
    await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`UPDATE users SET display_name = 'Ana G.' WHERE id = ${e.ana}`),
    );
    const [ana] = await db.db
      .select({ nombre: users.displayName })
      .from(users)
      .where(sql`${users.id} = ${e.ana}`);
    expect(ana?.nombre).toBe('Ana G.');
  });
});

describe('la función de login', () => {
  it('encuentra al usuario por su github_id sin necesidad de contexto', async () => {
    const filas = await asAppUser(db.db, null, (tx) =>
      tx.execute<{ handle: string }>(sql`SELECT handle FROM auth_find_user_by_github_id(2001)`),
    );
    expect(filas.rows[0]?.handle).toBe('ana');
  });

  it('no sirve para enumerar: un github_id inexistente no devuelve nada', async () => {
    const filas = await asAppUser(db.db, null, (tx) =>
      tx.execute(sql`SELECT * FROM auth_find_user_by_github_id(999999)`),
    );
    expect(filas.rows).toHaveLength(0);
  });

  it('sigue sin poder leerse la tabla directamente sin contexto', async () => {
    const filas = await asAppUser(db.db, null, (tx) => tx.execute(sql`SELECT id FROM users`));
    expect(filas.rows).toHaveLength(0);
  });
});
