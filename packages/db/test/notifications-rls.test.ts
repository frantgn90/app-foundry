import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { uuidv7 } from '@app-foundry/core';

import { apps, notifications, users, workspaceMembers } from '../src/index.js';
import { type Scenario, seed } from './scenario.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let e: Scenario;
/** Tiene cuenta y una invitación viva al workspace de Ana, pero aún no es miembro. */
let daniela: string;
let appDeAna: string;

function sqlstateOf(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as Error & { code?: string }).code;
    if (typeof code === 'string') return code;
    current = current.cause;
  }
  return undefined;
}

async function failure(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * Un aviso cualquiera dirigido a alguien, para no repetir el literal.
 *
 * El identificador se genera aquí en lugar de dejárselo a la base de datos, por
 * el mismo motivo que en el servicio de emisión: quien escribe un aviso ajeno no
 * puede releerlo, así que `RETURNING` no sirve para recuperarlo.
 */
function aviso(userId: string, workspaceId: string, extra: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    userId,
    workspaceId,
    type: 'APP_COMMENTED' as const,
    payload: { actorHandle: 'ana', appName: 'Una idea' },
    ...extra,
  };
}

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  // El escenario deja una invitación pendiente para esta dirección; aquí se le
  // da cuenta, que es el caso que la política tiene que dejar pasar.
  const [d] = await db.db
    .insert(users)
    .values({
      githubId: 2004,
      handle: 'daniela',
      email: 'daniela@example.com',
      displayName: 'Daniela',
    })
    .returning({ id: users.id });
  daniela = d!.id;

  const [app] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug: 'idea',
      name: 'Una idea',
      precursorId: e.ana,
      accessLevel: 'WORKSPACE_WRITE',
      iconEmoji: '💡',
      iconColor: 'amber',
    })
    .returning({ id: apps.id });
  appDeAna = app!.id;
}, 120_000);

afterAll(async () => {
  await db.stop();
});

describe('a quién se le puede escribir', () => {
  it('avisa a quien comparte workspace', async () => {
    const nuevo = aviso(e.bruno, e.wsAna, { appId: appDeAna });
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));

    const recibido = await asAppUser(db.db, e.bruno, async (tx) =>
      tx.select().from(notifications).where(eq(notifications.id, nuevo.id)),
    );
    expect(recibido).toHaveLength(1);
  });

  it('quien escribe un aviso no puede leerlo', async () => {
    // Escribir para otro y no poder mirarlo es justo lo que se quiere: el aviso
    // es de quien lo recibe. La consecuencia práctica es que la emisión no puede
    // usar `RETURNING`, porque leería una fila que no le pertenece, y de ahí que
    // el identificador se genere antes de insertar.
    const nuevo = aviso(e.bruno, e.wsAna);
    const error = await failure(() =>
      asAppUser(db.db, e.ana, async (tx) =>
        tx.insert(notifications).values(nuevo).returning({ id: notifications.id }),
      ),
    );

    expect(sqlstateOf(error)).toBe('42501');

    // Y sin `RETURNING` la misma inserción sí entra.
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));
    const recibido = await asAppUser(db.db, e.bruno, async (tx) =>
      tx.select().from(notifications).where(eq(notifications.id, nuevo.id)),
    );
    expect(recibido).toHaveLength(1);
  });

  it('no deja fabricar avisos para un desconocido', async () => {
    // Carla no comparte nada con Ana. Si esto pasara, cualquiera podría escribir
    // a cualquiera probando identificadores, y de paso confirmar que existen.
    const error = await failure(() =>
      asAppUser(db.db, e.ana, async (tx) =>
        tx.insert(notifications).values(aviso(e.carla, e.wsAna)),
      ),
    );

    expect(sqlstateOf(error)).toBe('42501');
  });

  it('no deja escribir en un workspace ajeno', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.ana, async (tx) =>
        tx.insert(notifications).values(aviso(e.bruno, e.wsBruno)),
      ),
    );

    expect(sqlstateOf(error)).toBe('42501');
  });

  it('nadie se avisa a sí mismo', async () => {
    // El dominio ya lo evita, pero un descuido al calcular destinatarios es
    // fácil y silencioso: aquí no llega a escribirse (RF-905).
    const error = await failure(() =>
      asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(aviso(e.ana, e.wsAna))),
    );

    expect(sqlstateOf(error)).toBe('42501');
  });

  it('la invitación alcanza a quien todavía no es miembro', async () => {
    const id = uuidv7();
    await asAppUser(db.db, e.ana, async (tx) =>
      tx.insert(notifications).values({
        id,
        userId: daniela,
        workspaceId: e.wsAna,
        type: 'WORKSPACE_INVITED',
        payload: { workspaceName: 'Workspace de Ana' },
      }),
    );

    const recibido = await asAppUser(db.db, daniela, async (tx) =>
      tx.select().from(notifications).where(eq(notifications.id, id)),
    );
    expect(recibido).toHaveLength(1);
  });

  it('pero solo para invitar, no para cualquier otra cosa', async () => {
    // Estar invitado no convierte a alguien en destinatario de todo lo que pase
    // dentro: hasta que acepta, lo único que le incumbe es la invitación.
    const error = await failure(() =>
      asAppUser(db.db, e.ana, async (tx) =>
        tx.insert(notifications).values(aviso(daniela, e.wsAna)),
      ),
    );

    expect(sqlstateOf(error)).toBe('42501');
  });
});

describe('lo que cada uno ve', () => {
  it('solo las propias', async () => {
    const deBruno = await asAppUser(db.db, e.bruno, async (tx) => tx.select().from(notifications));
    const deAna = await asAppUser(db.db, e.ana, async (tx) => tx.select().from(notifications));

    expect(deBruno.every((n) => n.userId === e.bruno)).toBe(true);
    expect(deBruno.length).toBeGreaterThan(0);
    // Ana ha escrito avisos, pero ninguno es para ella.
    expect(deAna).toHaveLength(0);
  });

  it('deja de verse al perder el acceso al workspace', async () => {
    // RF-906: el aviso no se borra al salir del workspace, pero deja de estar
    // accesible.
    const [otro] = await db.db
      .insert(users)
      .values({ githubId: 2005, handle: 'elena', email: 'elena@example.com', displayName: 'Elena' })
      .returning({ id: users.id });
    await db.db
      .insert(workspaceMembers)
      .values({ workspaceId: e.wsAna, userId: otro!.id, role: 'MEMBER' });

    const nuevo = aviso(otro!.id, e.wsAna);
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));

    const antes = await asAppUser(db.db, otro!.id, async (tx) => tx.select().from(notifications));
    expect(antes).toHaveLength(1);

    await db.db
      .delete(workspaceMembers)
      .where(
        sql`${workspaceMembers.workspaceId} = ${e.wsAna} AND ${workspaceMembers.userId} = ${otro!.id}`,
      );

    const despues = await asAppUser(db.db, otro!.id, async (tx) => tx.select().from(notifications));
    expect(despues).toHaveLength(0);
  });

  it('y entonces tampoco se puede purgar a mano', async () => {
    /*
     * Consecuencia de lo anterior que conviene dejar fijada, porque no es
     * evidente: Postgres aplica las políticas de lectura también al resolver el
     * WHERE de un borrado, así que un aviso invisible es además imposible de
     * borrar para su dueño.
     *
     * No es un problema —lo que no está en tu lista no necesitas vaciarlo— pero
     * sí obliga a que la purga automática no dependa de estas políticas, o esos
     * avisos se quedarían en la tabla para siempre (RF-910).
     */
    const [ajeno] = await db.db
      .insert(users)
      .values({ githubId: 2006, handle: 'felipe', email: 'felipe@example.com', displayName: 'F' })
      .returning({ id: users.id });
    await db.db
      .insert(workspaceMembers)
      .values({ workspaceId: e.wsAna, userId: ajeno!.id, role: 'MEMBER' });

    const nuevo = aviso(ajeno!.id, e.wsAna);
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));
    await db.db
      .delete(workspaceMembers)
      .where(
        sql`${workspaceMembers.workspaceId} = ${e.wsAna} AND ${workspaceMembers.userId} = ${ajeno!.id}`,
      );

    await asAppUser(db.db, ajeno!.id, async (tx) =>
      tx.delete(notifications).where(eq(notifications.id, nuevo.id)),
    );

    const quedan = await db.db.select().from(notifications).where(eq(notifications.id, nuevo.id));
    expect(quedan).toHaveLength(1);
  });

  it('un aviso sobre una app que no se puede ver tampoco se ve', async () => {
    // RF-906. La comprobación se apoya en la política de `apps`, así que basta
    // con que la app sea privada de Ana: Bruno es del workspace, y aun así el
    // aviso no le llega a la vista.
    const [privada] = await db.db
      .insert(apps)
      .values({
        workspaceId: e.wsAna,
        slug: 'secreta',
        name: 'Secreta',
        precursorId: e.ana,
        accessLevel: 'PRIVATE',
        iconEmoji: '🔒',
        iconColor: 'slate',
      })
      .returning({ id: apps.id });

    const nuevo = aviso(e.bruno, e.wsAna, { appId: privada!.id });
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));

    const paraBruno = await asAppUser(db.db, e.bruno, async (tx) =>
      tx.select().from(notifications).where(eq(notifications.id, nuevo.id)),
    );
    expect(paraBruno).toHaveLength(0);

    // Y sigue existiendo: dejar de verse no es lo mismo que borrarse (RF-911).
    const existe = await db.db.select().from(notifications).where(eq(notifications.id, nuevo.id));
    expect(existe).toHaveLength(1);
  });
});

describe('qué se puede cambiar y borrar', () => {
  it('marcar leída sí; reescribir el contenido no', async () => {
    const nuevo = aviso(e.bruno, e.wsAna);
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));

    const marcada = await asAppUser(db.db, e.bruno, async (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, nuevo.id))
        .returning({ id: notifications.id }),
    );
    expect(marcada).toHaveLength(1);

    // Las políticas filtran filas, nunca columnas: quien lo impide es el permiso
    // de columna, y por eso el error es de permiso y no una fila que no aparece.
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, async (tx) =>
        tx
          .update(notifications)
          .set({ payload: { actorHandle: 'otro' } })
          .where(eq(notifications.id, nuevo.id)),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('nadie purga los avisos de otro', async () => {
    const nuevo = aviso(e.bruno, e.wsAna);
    await asAppUser(db.db, e.ana, async (tx) => tx.insert(notifications).values(nuevo));

    const borradas = await asAppUser(db.db, e.ana, async (tx) =>
      tx
        .delete(notifications)
        .where(eq(notifications.id, nuevo.id))
        .returning({ id: notifications.id }),
    );

    // No es un error: la fila sencillamente no existe para Ana, así que el
    // borrado no encuentra nada. Lo que importa es que siga ahí.
    expect(borradas).toHaveLength(0);
    const sigue = await asAppUser(db.db, e.bruno, async (tx) =>
      tx.select().from(notifications).where(eq(notifications.id, nuevo.id)),
    );
    expect(sigue).toHaveLength(1);
  });
});
