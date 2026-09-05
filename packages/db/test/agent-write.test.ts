import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  agentPromptRevisions,
  agents,
  apps,
  comments,
  commentThreads,
  documents,
} from '../src/index.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';
import { type Scenario, seed } from './scenario.js';

let db: TestDb;
let e: Scenario;

/**
 * La única puerta por la que un agente escribe.
 *
 * Todo se ejecuta con el rol de la aplicación, que es el único que importa:
 * probar esto como superusuario no diría nada, porque un superusuario se salta
 * las políticas y la función dejaría de ser la única vía sin que nadie lo
 * notara.
 */
let appAbierta: string;
let appPrivada: string;
let hiloAbierto: string;
let hiloPrivado: string;
let elAgente: string;
let suPerfil: string;
let agenteDeLaPrivada: string;
let perfilDeLaPrivada: string;

async function crearHilo(appId: string, documentId: string, autor: string): Promise<string> {
  const [hilo] = await db.db
    .insert(commentThreads)
    .values({ appId, documentId, kind: 'GENERAL', createdBy: autor })
    .returning({ id: commentThreads.id });
  return hilo!.id;
}

async function crearAgente(appId: string, handle: string) {
  const [agente] = await db.db
    .insert(agents)
    .values({
      appId,
      name: 'Product Owner',
      handle,
      iconEmoji: '🎯',
      iconColor: 'amber',
      addedBy: e.ana,
    })
    .returning({ id: agents.id });

  const [revision] = await db.db
    .insert(agentPromptRevisions)
    .values({ agentId: agente!.id, revision: 1, prompt: 'Ask what problem this solves.' })
    .returning({ id: agentPromptRevisions.id });

  return { agentId: agente!.id, revisionId: revision!.id };
}

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  const [abierta] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug: 'abierta',
      name: 'Abierta',
      precursorId: e.ana,
      accessLevel: 'WORKSPACE_WRITE',
      iconEmoji: '🔓',
      iconColor: 'teal',
    })
    .returning({ id: apps.id });
  appAbierta = abierta!.id;

  const [privada] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug: 'privada',
      name: 'Privada',
      precursorId: e.ana,
      accessLevel: 'PRIVATE',
      iconEmoji: '🔒',
      iconColor: 'rose',
    })
    .returning({ id: apps.id });
  appPrivada = privada!.id;

  const [docA] = await db.db
    .insert(documents)
    .values({ appId: appAbierta, type: 'VISION' })
    .returning({ id: documents.id });
  const [docP] = await db.db
    .insert(documents)
    .values({ appId: appPrivada, type: 'VISION' })
    .returning({ id: documents.id });

  hiloAbierto = await crearHilo(appAbierta, docA!.id, e.ana);
  hiloPrivado = await crearHilo(appPrivada, docP!.id, e.ana);

  const abiertoAgente = await crearAgente(appAbierta, 'po');
  elAgente = abiertoAgente.agentId;
  suPerfil = abiertoAgente.revisionId;

  const privadoAgente = await crearAgente(appPrivada, 'po');
  agenteDeLaPrivada = privadoAgente.agentId;
  perfilDeLaPrivada = privadoAgente.revisionId;
}, 180_000);

afterAll(async () => {
  await db.stop();
});

/** Llama a la puerta con el rol de la aplicación y la identidad indicada. */
function escribir(
  quien: string | null,
  args: {
    threadId?: string;
    agentId?: string;
    revisionId?: string;
    body?: string;
  } = {},
) {
  const threadId = args.threadId ?? hiloAbierto;
  const agentId = args.agentId ?? elAgente;
  const revisionId = args.revisionId ?? suPerfil;
  const body = args.body ?? 'Scope looks wider than the problem.';

  return asAppUser(db.db, quien, (tx) =>
    tx.execute<{ agent_write_comment: string }>(
      sql`SELECT agent_write_comment(${threadId}::uuid, ${agentId}::uuid, ${revisionId}::uuid, ${body})`,
    ),
  );
}

async function fallo(fn: () => Promise<unknown>): Promise<string> {
  const partes: string[] = [];
  try {
    await fn();
    return '';
  } catch (error: unknown) {
    let actual: unknown = error;
    while (actual instanceof Error) {
      partes.push(actual.message);
      actual = actual.cause;
    }
    return partes.join(' | ');
  }
}

describe('sin la función no se escribe', () => {
  it('un INSERT directo a nombre de un agente se rechaza, aunque todo cuadre', async () => {
    const mensaje = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(comments).values({
          threadId: hiloAbierto,
          body: 'Por la puerta de atrás.',
          authorAgentId: elAgente,
          agentPromptRevisionId: suPerfil,
        }),
      ),
    );
    expect(mensaje).not.toBe('');
  });
});

describe('la puerta, con quien la cruza', () => {
  it('escribe cuando quien la llama ve la app', async () => {
    await expect(escribir(e.ana)).resolves.toBeDefined();

    const suyos = await db.db.select().from(comments).where(eq(comments.authorAgentId, elAgente));
    expect(suyos).toHaveLength(1);
    expect(suyos[0]!.authorId).toBeNull();
    expect(suyos[0]!.agentPromptRevisionId).toBe(suPerfil);
  });

  it('también si quien la llama es un invitado con acceso a esa app', async () => {
    await expect(escribir(e.bruno, { body: 'Otra cosa.' })).resolves.toBeDefined();
  });

  it('sin identidad, no: un agente escribe siempre a cuenta de alguien', async () => {
    const mensaje = await fallo(() => escribir(null));
    expect(mensaje).toContain('needs the identity of whoever triggered it');
  });

  it('un extraño no puede provocar una escritura en una app que no ve', async () => {
    const mensaje = await fallo(() => escribir(e.carla));
    expect(mensaje).toContain('does not exist here');
  });

  it('ni un miembro sobre una app privada que no es suya', async () => {
    /*
     * Es la comprobación que sostiene el diseño: la función se salta la RLS, así
     * que si esta no estuviera escrita a mano, Bruno podría hacer hablar a un
     * agente dentro de una app de Ana que él no ve.
     */
    const mensaje = await fallo(() =>
      escribir(e.bruno, {
        threadId: hiloPrivado,
        agentId: agenteDeLaPrivada,
        revisionId: perfilDeLaPrivada,
      }),
    );
    expect(mensaje).toContain('does not exist here');
  });

  it('y su precursora sí', async () => {
    await expect(
      escribir(e.ana, {
        threadId: hiloPrivado,
        agentId: agenteDeLaPrivada,
        revisionId: perfilDeLaPrivada,
      }),
    ).resolves.toBeDefined();
  });
});

describe('la puerta, con lo que se le pide', () => {
  it('un agente de otra app no escribe aquí, ni acertando su identificador', async () => {
    const mensaje = await fallo(() =>
      escribir(e.ana, { agentId: agenteDeLaPrivada, revisionId: perfilDeLaPrivada }),
    );
    expect(mensaje).toContain('does not belong to this app');
  });

  it('un perfil de otro agente tampoco: diría que habló como no era', async () => {
    const mensaje = await fallo(() => escribir(e.ana, { revisionId: perfilDeLaPrivada }));
    expect(mensaje).toContain('belongs to another agent');
  });

  it('un agente desactivado no interviene', async () => {
    await db.db.update(agents).set({ active: false }).where(eq(agents.id, elAgente));

    const mensaje = await fallo(() => escribir(e.ana));
    expect(mensaje).toContain('is not active in this app');

    await db.db.update(agents).set({ active: true }).where(eq(agents.id, elAgente));
  });

  it('ni uno retirado, aunque su fila siga ahí', async () => {
    await db.db
      .update(agents)
      .set({ removedAt: new Date(), active: false })
      .where(eq(agents.id, elAgente));

    const mensaje = await fallo(() => escribir(e.ana));
    expect(mensaje).toContain('is not active in this app');
  });
});
