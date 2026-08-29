import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apps, commentMentions, comments, commentThreads, documents } from '../src/index.js';
import { type Scenario, seed } from './scenario.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let e: Scenario;
/** App de Ana en WORKSPACE_READ: Bruno la lee pero no la edita. */
let appLectura: string;
let documentoLectura: string;
let hiloDeAna: string;

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

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  const [app] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug: 'lectura',
      name: 'Lectura',
      precursorId: e.ana,
      accessLevel: 'WORKSPACE_READ',
      iconEmoji: '📖',
      iconColor: 'teal',
    })
    .returning({ id: apps.id });
  appLectura = app!.id;

  const [doc] = await db.db
    .insert(documents)
    .values({ appId: appLectura, type: 'VISION', currentContent: '# Una idea' })
    .returning({ id: documents.id });
  documentoLectura = doc!.id;

  const [thread] = await db.db
    .insert(commentThreads)
    .values({
      appId: appLectura,
      documentId: documentoLectura,
      kind: 'GENERAL',
      createdBy: e.ana,
    })
    .returning({ id: commentThreads.id });
  hiloDeAna = thread!.id;
});

afterAll(async () => {
  await db?.stop();
});

describe('comentar solo exige poder leer (RF-803, D-12)', () => {
  it('un invitado que no puede editar la app sí puede abrir un hilo', async () => {
    const creado = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .insert(commentThreads)
        .values({
          appId: appLectura,
          documentId: documentoLectura,
          kind: 'GENERAL',
          createdBy: e.bruno,
        })
        .returning({ id: commentThreads.id }),
    );
    expect(creado[0]?.id).toBeTruthy();
  });

  it('y puede responder en el hilo de otra persona', async () => {
    const creado = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .insert(comments)
        .values({ threadId: hiloDeAna, body: 'Me parece bien', authorId: e.bruno })
        .returning({ id: comments.id }),
    );
    expect(creado[0]?.id).toBeTruthy();
  });

  it('quien no ve la app no ve sus hilos', async () => {
    const vistos = await asAppUser(db.db, e.carla, (tx) => tx.select().from(commentThreads));
    expect(vistos).toHaveLength(0);
  });
});

describe('la autoría no se falsifica', () => {
  it('no se puede comentar a nombre de otro', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx
          .insert(comments)
          .values({ threadId: hiloDeAna, body: 'Firmado por Ana', authorId: e.ana }),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('ni editar el comentario de otro', async () => {
    const [deAna] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Lo que dijo Ana', authorId: e.ana })
      .returning({ id: comments.id });

    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(sql`UPDATE comments SET body = 'reescrito' WHERE id = ${deAna!.id}`),
    );

    const [despues] = await db.db
      .select({ body: comments.body })
      .from(comments)
      .where(sql`${comments.id} = ${deAna!.id}`);
    expect(despues?.body).toBe('Lo que dijo Ana');
  });
});

describe('el borrado es lógico (R4)', () => {
  it('nadie puede borrar comentarios de verdad', async () => {
    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) => tx.execute(sql`DELETE FROM comments`)),
    );
    // Borrar dejaría huecos en la conversación y se llevaría las respuestas
    // que colgaban de ese comentario.
    expect(sqlstateOf(error)).toBe('42501');
  });

  it('marcarlo como borrado conserva el hilo y su autoría', async () => {
    const [propio] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Me arrepiento', authorId: e.bruno })
      .returning({ id: comments.id });

    await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(sql`UPDATE comments SET deleted_at = now() WHERE id = ${propio!.id}`),
    );

    const [despues] = await db.db
      .select({ deletedAt: comments.deletedAt, authorId: comments.authorId })
      .from(comments)
      .where(sql`${comments.id} = ${propio!.id}`);
    expect(despues?.deletedAt).not.toBeNull();
    expect(despues?.authorId).toBe(e.bruno);
  });
});

describe('un solo nivel de anidamiento (R2, RF-804)', () => {
  it('se puede responder a un comentario raíz', async () => {
    const [raiz] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Pregunta', authorId: e.ana })
      .returning({ id: comments.id });

    const respuesta = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .insert(comments)
        .values({ threadId: hiloDeAna, body: 'Respuesta', authorId: e.bruno, parentId: raiz!.id })
        .returning({ id: comments.id }),
    );
    expect(respuesta[0]?.id).toBeTruthy();
  });

  it('pero no a una respuesta: lo impide el motor, no la interfaz', async () => {
    const [raiz] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Otra', authorId: e.ana })
      .returning({ id: comments.id });
    const [respuesta] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Su respuesta', authorId: e.ana, parentId: raiz!.id })
      .returning({ id: comments.id });

    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(comments).values({
          threadId: hiloDeAna,
          body: 'Respuesta a la respuesta',
          authorId: e.bruno,
          parentId: respuesta!.id,
        }),
      ),
    );
    expect(sqlstateOf(error)).toBe('23514');
  });
});

describe('borrar hilos', () => {
  it('el precursor de la app puede borrar cualquier hilo', async () => {
    const [ajeno] = await db.db
      .insert(commentThreads)
      .values({
        appId: appLectura,
        documentId: documentoLectura,
        kind: 'GENERAL',
        createdBy: e.bruno,
      })
      .returning({ id: commentThreads.id });

    const borrados = await asAppUser(db.db, e.ana, (tx) =>
      tx.execute(sql`DELETE FROM comment_threads WHERE id = ${ajeno!.id} RETURNING id`),
    );
    expect(borrados.rows).toHaveLength(1);
  });

  it('un invitado cualquiera no puede borrar el hilo de otro', async () => {
    const borrados = await asAppUser(db.db, e.bruno, (tx) =>
      tx.execute(sql`DELETE FROM comment_threads WHERE id = ${hiloDeAna} RETURNING id`),
    );
    expect(borrados.rows).toHaveLength(0);
  });
});

describe('menciones acotadas al workspace (RF-815)', () => {
  it('se puede mencionar a alguien del workspace', async () => {
    const [comentario] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Mira esto @ana', authorId: e.bruno })
      .returning({ id: comments.id });

    const creada = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .insert(commentMentions)
        .values({ commentId: comentario!.id, userId: e.ana })
        .returning({ userId: commentMentions.userId }),
    );
    expect(creada[0]?.userId).toBe(e.ana);
  });

  it('pero no a alguien de fuera', async () => {
    const [comentario] = await db.db
      .insert(comments)
      .values({ threadId: hiloDeAna, body: 'Mira esto @carla', authorId: e.bruno })
      .returning({ id: comments.id });

    const error = await failure(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(commentMentions).values({ commentId: comentario!.id, userId: e.carla }),
      ),
    );
    // Mencionar no puede ser una vía para averiguar quién más usa la plataforma.
    expect(sqlstateOf(error)).toBe('42501');
  });
});

describe('una app archivada deja sus comentarios en solo lectura (RF-812)', () => {
  it('no se pueden abrir hilos nuevos', async () => {
    await db.db.execute(sql`UPDATE apps SET archived_at = now() WHERE id = ${appLectura}`);

    const error = await failure(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(commentThreads).values({
          appId: appLectura,
          documentId: documentoLectura,
          kind: 'GENERAL',
          createdBy: e.ana,
        }),
      ),
    );
    expect(sqlstateOf(error)).toBe('42501');

    // Pero lo escrito se sigue viendo.
    const vistos = await asAppUser(db.db, e.ana, (tx) => tx.select().from(commentThreads));
    expect(vistos.length).toBeGreaterThan(0);

    await db.db.execute(sql`UPDATE apps SET archived_at = NULL WHERE id = ${appLectura}`);
  });
});
