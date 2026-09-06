import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  agentReviewRuns,
  agentReviews,
  agents,
  apps,
  documents,
  documentVersions,
} from '../src/index.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';
import { type Scenario, seed } from './scenario.js';

/**
 * El aislamiento de la revisión en abanico, con el rol de la aplicación.
 *
 * Lo que se comprueba aquí, además del reparto de siempre, es la regla que se
 * sale de lo habitual: **pedir una revisión basta con poder leer la app**
 * (RF-1608). En el resto del modelo de agentes escribir exige poder editar, así
 * que si esta política se hubiera copiado de al lado, Bruno no podría pedir que
 * le lean una app que sí puede leer, y el fallo no saltaría en ningún otro test.
 *
 * Escenario: Ana es dueña, Bruno es miembro y Carla no comparte nada.
 * `appAbierta` la ve y la edita todo el workspace; `appSoloLectura` la ve Bruno
 * pero no la edita; `appPrivada` es de Ana y solo suya.
 */
let db: TestDb;
let e: Scenario;

let appAbierta: string;
let appSoloLectura: string;
let appPrivada: string;
let versionAbierta: string;
let versionSoloLectura: string;
let agenteAbierto: string;
let revisionDeAna: string;

async function fallo(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * El `SQLSTATE` del fallo, esté donde esté de la cadena de causas.
 *
 * Drizzle envuelve el error del driver, así que el código no está en el objeto
 * que llega sino en su causa. Mirar solo el primer nivel daba `undefined` y la
 * comprobación pasaba a ser «falló por algo», que no distingue un único
 * violado de un error de sintaxis.
 */
function sqlstate(error: unknown): string | null {
  let actual: unknown = error;
  while (actual instanceof Error) {
    const codigo = (actual as Error & { code?: string }).code;
    if (typeof codigo === 'string') return codigo;
    actual = actual.cause;
  }
  return null;
}

/** Una app con su documento, una versión y un agente. */
async function crearApp(
  slug: string,
  accessLevel: 'WORKSPACE_WRITE' | 'WORKSPACE_READ' | 'PRIVATE',
) {
  const [app] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug,
      name: slug,
      precursorId: e.ana,
      accessLevel,
      iconEmoji: '💡',
      iconColor: 'amber',
    })
    .returning({ id: apps.id });

  const [doc] = await db.db
    .insert(documents)
    .values({ appId: app!.id, type: 'VISION' })
    .returning({ id: documents.id });

  const [version] = await db.db
    .insert(documentVersions)
    .values({
      documentId: doc!.id,
      versionNo: 1,
      content: '# La idea\n\nUn documento.',
      authorId: e.ana,
      message: 'Primera',
    })
    .returning({ id: documentVersions.id });

  const [agente] = await db.db
    .insert(agents)
    .values({
      appId: app!.id,
      name: 'Product Owner',
      handle: 'po',
      iconEmoji: '🎯',
      iconColor: 'amber',
      addedBy: e.ana,
    })
    .returning({ id: agents.id });

  return { appId: app!.id, versionId: version!.id, agentId: agente!.id };
}

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  const abierta = await crearApp('abierta', 'WORKSPACE_WRITE');
  appAbierta = abierta.appId;
  versionAbierta = abierta.versionId;
  agenteAbierto = abierta.agentId;

  const soloLectura = await crearApp('solo-lectura', 'WORKSPACE_READ');
  appSoloLectura = soloLectura.appId;
  versionSoloLectura = soloLectura.versionId;

  const privada = await crearApp('privada', 'PRIVATE');
  appPrivada = privada.appId;

  const [revision] = await db.db
    .insert(agentReviews)
    .values({
      appId: appAbierta,
      requestedBy: e.ana,
      versionId: versionAbierta,
      estimatedTokens: 12_000,
    })
    .returning({ id: agentReviews.id });
  revisionDeAna = revision!.id;

  await db.db.insert(agentReviewRuns).values({
    reviewId: revisionDeAna,
    agentId: agenteAbierto,
    idempotencyKey: `${revisionDeAna}:${agenteAbierto}`,
  });
}, 180_000);

afterAll(async () => {
  await db.stop();
});

describe('quién ve una revisión', () => {
  it('quien ve la app, aunque no sea suya', async () => {
    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(agentReviews));

    expect(vistas).toHaveLength(1);
  });

  it('un extraño no ve ninguna', async () => {
    const vistas = await asAppUser(db.db, e.carla, (tx) => tx.select().from(agentReviews));

    expect(vistas).toHaveLength(0);
  });

  it('sin identidad tampoco: el defecto es no ver', async () => {
    const vistas = await asAppUser(db.db, null, (tx) => tx.select().from(agentReviews));

    expect(vistas).toHaveLength(0);
  });

  it('y sus ejecuciones se ven con ella, que es lo que enseña el progreso', async () => {
    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(agentReviewRuns));

    expect(vistas).toHaveLength(1);
  });
});

describe('quién puede pedirla', () => {
  it('basta con poder leer la app: no hace falta poder editarla', async () => {
    /*
     * La regla que se sale de lo habitual (RF-1608, D-12). Bruno no puede
     * editar esta app —es WORKSPACE_READ— y aun así puede pedir que le lean:
     * pedir una revisión no cambia nada del documento.
     */
    const pedida = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .insert(agentReviews)
        .values({
          appId: appSoloLectura,
          requestedBy: e.bruno,
          versionId: versionSoloLectura,
          estimatedTokens: 9_000,
        })
        .returning({ id: agentReviews.id }),
    );

    expect(pedida).toHaveLength(1);
  });

  it('pero no a nombre de otro', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(agentReviews).values({
          appId: appAbierta,
          requestedBy: e.ana,
          versionId: versionAbierta,
          estimatedTokens: 1_000,
        }),
      ),
    );

    expect(error).not.toBeNull();
  });

  it('ni sobre una app que no ve', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(agentReviews).values({
          appId: appPrivada,
          requestedBy: e.bruno,
          versionId: versionAbierta,
          estimatedTokens: 1_000,
        }),
      ),
    );

    expect(error).not.toBeNull();
  });
});

describe('dos revisiones de la misma app no se solapan', () => {
  it('el motor rechaza la segunda mientras la primera siga viva', async () => {
    /*
     * RF-1609 no depende de que el servicio se acuerde de comprobarlo: un
     * `SELECT` previo deja una carrera entre mirar y escribir, y perderla
     * cuesta pagar dos revisiones enteras del mismo documento.
     */
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(agentReviews).values({
          appId: appAbierta,
          requestedBy: e.ana,
          versionId: versionAbierta,
          estimatedTokens: 1_000,
        }),
      ),
    );

    expect(sqlstate(error)).toBe('23505');
  });

  it('y la deja pasar en cuanto la anterior se cierra', async () => {
    await db.db
      .update(agentReviews)
      .set({ status: 'DONE', finishedAt: new Date() })
      .where(eq(agentReviews.id, revisionDeAna));

    const segunda = await asAppUser(db.db, e.ana, (tx) =>
      tx
        .insert(agentReviews)
        .values({
          appId: appAbierta,
          requestedBy: e.ana,
          versionId: versionAbierta,
          estimatedTokens: 1_000,
        })
        .returning({ id: agentReviews.id }),
    );

    expect(segunda).toHaveLength(1);

    /* Se deja como estaba para no condicionar a quien venga detrás. */
    await db.db
      .update(agentReviews)
      .set({ status: 'DONE' })
      .where(eq(agentReviews.id, segunda[0]!.id));
  });
});

describe('quién la mueve', () => {
  it('quien la pidió', async () => {
    const movida = await asAppUser(db.db, e.ana, (tx) =>
      tx
        .update(agentReviews)
        .set({ status: 'CANCELLED' })
        .where(eq(agentReviews.id, revisionDeAna))
        .returning({ id: agentReviews.id }),
    );

    expect(movida).toHaveLength(1);
  });

  it('un miembro que solo la ve, no', async () => {
    const movida = await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .update(agentReviews)
        .set({ status: 'FAILED' })
        .where(eq(agentReviews.id, revisionDeAna))
        .returning({ id: agentReviews.id }),
    );

    /* La política no lo deja tocar ninguna fila: no falla, no hace nada. */
    expect(movida).toHaveLength(0);
  });

  it('y nadie las borra: cancelar es cambiar de estado, no desaparecer', async () => {
    const borradas = await asAppUser(db.db, e.ana, (tx) =>
      tx
        .delete(agentReviews)
        .where(eq(agentReviews.id, revisionDeAna))
        .returning({ id: agentReviews.id }),
    );

    expect(borradas).toHaveLength(0);
  });
});

describe('la clave de idempotencia', () => {
  it('no admite dos ejecuciones con la misma', async () => {
    const error = await fallo(() =>
      db.db.insert(agentReviewRuns).values({
        reviewId: revisionDeAna,
        agentId: agenteAbierto,
        idempotencyKey: `${revisionDeAna}:${agenteAbierto}`,
      }),
    );

    expect(sqlstate(error)).toBe('23505');
  });

  it('ni al mismo agente dos veces en la misma revisión', async () => {
    const error = await fallo(() =>
      db.db.insert(agentReviewRuns).values({
        reviewId: revisionDeAna,
        agentId: agenteAbierto,
        idempotencyKey: 'otra-clave-distinta',
      }),
    );

    expect(sqlstate(error)).toBe('23505');
  });
});

describe('el rastro del gasto', () => {
  it('una invocación puede decir de qué ejecución salió', async () => {
    /*
     * Es lo que permite contestar «cuánto costó la revisión del martes» sin
     * cruzar por tiempo, que es como se cuentan mal las cosas que corren en
     * paralelo (RD-10).
     */
    const [columna] = (
      await db.db.execute<{ existe: boolean }>(
        sql`SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'ai_invocations' AND column_name = 'review_run_id'
            ) AS existe`,
      )
    ).rows;

    expect(columna!.existe).toBe(true);
  });

  it('y un hilo, de qué revisión salió', async () => {
    const [columna] = (
      await db.db.execute<{ existe: boolean }>(
        sql`SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'comment_threads' AND column_name = 'review_id'
            ) AS existe`,
      )
    ).rows;

    expect(columna!.existe).toBe(true);
  });
});
