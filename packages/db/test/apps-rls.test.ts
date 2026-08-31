import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apps, documents, documentVersions, workspaceMembers } from '../src/index.js';
import { type Scenario, seed } from './scenario.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let e: Scenario;
let appPrivada: string;
let appLectura: string;
let appEscritura: string;
let documentoEscritura: string;

function sqlstateOf(error: unknown): string | undefined {
  let actual: unknown = error;
  while (actual instanceof Error) {
    const code = (actual as Error & { code?: string }).code;
    if (typeof code === 'string') return code;
    actual = actual.cause;
  }
  return undefined;
}

async function failure(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

/** Crea una app como superusuario, saltando las políticas para preparar el escenario. */
async function crearApp(nivel: 'PRIVATE' | 'WORKSPACE_READ' | 'WORKSPACE_WRITE', slug: string) {
  const [creada] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug,
      name: slug,
      precursorId: e.ana,
      accessLevel: nivel,
      iconEmoji: '💡',
      iconColor: 'amber',
    })
    .returning({ id: apps.id });
  return creada!.id;
}

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  appPrivada = await crearApp('PRIVATE', 'privada');
  appLectura = await crearApp('WORKSPACE_READ', 'lectura');
  appEscritura = await crearApp('WORKSPACE_WRITE', 'escritura');

  const [doc] = await db.db
    .insert(documents)
    .values({ appId: appEscritura, type: 'VISION', currentContent: '# Idea' })
    .returning({ id: documents.id });
  documentoEscritura = doc!.id;

  await db.db.insert(documentVersions).values({
    documentId: documentoEscritura,
    versionNo: 1,
    content: '# Idea',
    authorId: e.ana,
  });
});

afterAll(async () => {
  await db?.stop();
});

describe('quién ve cada app', () => {
  it('el precursor ve las suyas, sea cual sea su nivel', async () => {
    const vistas = await asAppUser(db.db, e.ana, (tx) => tx.select().from(apps));
    expect(vistas.map((a) => a.slug).sort()).toEqual(['escritura', 'lectura', 'privada']);
  });

  it('un invitado ve las compartidas y no la privada', async () => {
    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(apps));
    expect(vistas.map((a) => a.slug).sort()).toEqual(['escritura', 'lectura']);
  });

  it('quien no pertenece al workspace no ve ninguna', async () => {
    const vistas = await asAppUser(db.db, e.carla, (tx) => tx.select().from(apps));
    expect(vistas).toHaveLength(0);
  });
});

describe('quién puede editar', () => {
  it('un invitado edita una app en WORKSPACE_WRITE', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(sql`UPDATE apps SET short_description = 'editada' WHERE id = ${appEscritura}`),
    );
    const [fila] = await db.db
      .select({ d: apps.shortDescription })
      .from(apps)
      .where(sql`${apps.id} = ${appEscritura}`);
    expect(fila?.d).toBe('editada');
  });

  it('un invitado no edita una app en WORKSPACE_READ', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(sql`UPDATE apps SET short_description = 'colada' WHERE id = ${appLectura}`),
    );
    const [fila] = await db.db
      .select({ d: apps.shortDescription })
      .from(apps)
      .where(sql`${apps.id} = ${appLectura}`);
    expect(fila?.d).toBeNull();
  });
});

describe('lo que crea un invitado nace compartido (D-9)', () => {
  it('un invitado puede crear una app en el workspace ajeno', async () => {
    const creada = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .insert(apps)
        .values({
          workspaceId: e.wsAna,
          slug: 'de-bruno',
          name: 'De Bruno',
          precursorId: e.bruno,
          accessLevel: 'WORKSPACE_WRITE',
          iconEmoji: '🌱',
          iconColor: 'green',
        })
        .returning({ id: apps.id }),
    );
    expect(creada[0]?.id).toBeTruthy();
  });

  it('pero no puede crearla privada', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(apps).values({
          workspaceId: e.wsAna,
          slug: 'secreta',
          name: 'Secreta',
          precursorId: e.bruno,
          accessLevel: 'PRIVATE',
          iconEmoji: '🔒',
          iconColor: 'slate',
        }),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('ni cambiarle el nivel después: queda fijado', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.execute(sql`UPDATE apps SET access_level = 'PRIVATE' WHERE slug = 'de-bruno'`),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('el dueño del workspace tampoco puede cambiárselo: no es su precursor', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.execute(sql`UPDATE apps SET access_level = 'PRIVATE' WHERE slug = 'de-bruno'`),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('el precursor que sí es dueño del workspace lo cambia sin problema', async () => {
    await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`UPDATE apps SET access_level = 'WORKSPACE_READ' WHERE id = ${appPrivada}`),
    );
    const [fila] = await db.db
      .select({ n: apps.accessLevel })
      .from(apps)
      .where(sql`${apps.id} = ${appPrivada}`);
    expect(fila?.n).toBe('WORKSPACE_READ');
  });
});

describe('documentos y versiones', () => {
  it('quien ve la app ve su historial', async () => {
    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(documentVersions));
    expect(vistas).toHaveLength(1);
  });

  it('quien no ve la app no ve su historial', async () => {
    const vistas = await asAppUser(db.db, e.carla, (tx) => tx.select().from(documentVersions));
    expect(vistas).toHaveLength(0);
  });

  it('no se puede escribir una versión a nombre de otro', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(documentVersions).values({
          documentId: documentoEscritura,
          versionNo: 99,
          content: 'falsificada',
          authorId: e.ana,
        }),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('las versiones son inmutables: ni se editan ni se borran', async () => {
    for (const sentencia of [
      sql`UPDATE document_versions SET content = 'reescrita'`,
      sql`DELETE FROM document_versions`,
    ]) {
      const error = await failure(() => asAppUser(db.db, e.ana, (tx) => tx.execute(sentencia)));
      expect(sqlstateOf(error)).toBe('42501');
    }
  });

  it('una app archivada deja su documento en solo lectura', async () => {
    await db.db.execute(sql`UPDATE apps SET archived_at = now() WHERE id = ${appEscritura}`);

    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(documentVersions).values({
          documentId: documentoEscritura,
          versionNo: 2,
          content: 'sobre una app archivada',
          authorId: e.ana,
        }),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');

    await db.db.execute(sql`UPDATE apps SET archived_at = NULL WHERE id = ${appEscritura}`);
  });
});

describe('archivar es reversible (regresión)', () => {
  it('el precursor puede desarchivar su app', async () => {
    // La política de UPDATE exigía archived_at IS NULL para cualquier cambio,
    // así que una app archivada quedaba congelada para siempre: ni su propio
    // precursor podía revivirla. El síntoma era desconcertante, porque la
    // sentencia no fallaba, simplemente no afectaba a ninguna fila.
    await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`UPDATE apps SET archived_at = now() WHERE id = ${appLectura}`),
    );

    const desarchivadas = await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`UPDATE apps SET archived_at = NULL WHERE id = ${appLectura} RETURNING id`),
    );
    expect(desarchivadas.rows).toHaveLength(1);
  });

  it('mientras está archivada, no se puede cambiar nada más', async () => {
    await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`UPDATE apps SET archived_at = now() WHERE id = ${appLectura}`),
    );

    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.execute(sql`UPDATE apps SET name = 'Colado' WHERE id = ${appLectura}`),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');

    await db.db.execute(sql`UPDATE apps SET archived_at = NULL WHERE id = ${appLectura}`);
  });
});

describe('herencia del precursor al salir del workspace (K6, D-10)', () => {
  it('las apps de quien se va se quedan y pasan al dueño', async () => {
    const antes = await db.db
      .select({ p: apps.precursorId })
      .from(apps)
      .where(sql`${apps.slug} = 'de-bruno'`);
    expect(antes[0]?.p).toBe(e.bruno);

    // Bruno abandona el workspace de Ana.
    await db.db
      .delete(workspaceMembers)
      .where(
        sql`${workspaceMembers.workspaceId} = ${e.wsAna} AND ${workspaceMembers.userId} = ${e.bruno}`,
      );

    const despues = await db.db
      .select({ p: apps.precursorId })
      .from(apps)
      .where(sql`${apps.slug} = 'de-bruno'`);
    // La app sigue existiendo y ahora es de Ana: no queda huérfana.
    expect(despues[0]?.p).toBe(e.ana);
  });

  it('el historial conserva la autoría de quien lo escribió', async () => {
    const versiones = await db.db.select({ a: documentVersions.authorId }).from(documentVersions);
    expect(versiones.every((v) => v.a === e.ana)).toBe(true);
  });
});

/**
 * Coautoría de una versión (RF-516).
 *
 * Es la única tabla del sistema donde alguien escribe una fila a nombre de otro,
 * así que la política tiene que decir algo más que «puedes escribir aquí»: solo
 * se puede nombrar coautor a quien de verdad guardó desde el commit anterior. Si
 * no, quien commitea podría atribuirle a cualquiera una versión que no tocó.
 */
describe('quién puede figurar como coautor', () => {
  let version: string;

  beforeAll(async () => {
    // El test anterior sacó a Bruno del workspace; aquí vuelve a estar dentro.
    await db.db
      .insert(workspaceMembers)
      .values({ workspaceId: e.wsAna, userId: e.bruno, role: 'MEMBER' })
      .onConflictDoNothing();

    const [v] = await db.db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(sql`${documentVersions.documentId} = ${documentoEscritura}`);
    version = v!.id;
  });

  it('Bruno se apunta a sí mismo al guardar, y no a Ana', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(
        sql`INSERT INTO document_working_authors (document_id, user_id)
            VALUES (${documentoEscritura}, ${e.bruno})`,
      ),
    );

    const ajeno = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.execute(
          sql`INSERT INTO document_working_authors (document_id, user_id)
              VALUES (${documentoEscritura}, ${e.ana})`,
        ),
      ),
    );
    expect(sqlstateOf(ajeno)).toBe('42501');
  });

  it('quien guardó puede quedar como coautor', async () => {
    const insertadas = await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(
        sql`INSERT INTO document_version_coauthors (version_id, user_id)
            VALUES (${version}, ${e.bruno}) RETURNING user_id`,
      ),
    );
    expect(insertadas.rows).toHaveLength(1);
  });

  it('pero quien no ha escrito nada, no', async () => {
    // Carla ni siquiera ve la app; da igual que quien lo intente sea Ana.
    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.execute(
          sql`INSERT INTO document_version_coauthors (version_id, user_id)
              VALUES (${version}, ${e.carla})`,
        ),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('y la coautoría, como la versión, no se reescribe ni se borra', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.execute(sql`DELETE FROM document_version_coauthors WHERE version_id = ${version}`),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });
});
