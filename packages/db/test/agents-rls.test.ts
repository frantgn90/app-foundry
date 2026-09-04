import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  agentPromptRevisions,
  agents,
  agentTemplates,
  apps,
  commentAgentMentions,
  comments,
  commentThreads,
  documents,
} from '../src/index.js';
import { asAppUser, startTestDb, type TestDb } from './helpers.js';
import { type Scenario, seed } from './scenario.js';

let db: TestDb;
let e: Scenario;

/**
 * El aislamiento del modelo de agentes, con el rol de la aplicación.
 *
 * Se ejecuta todo con `SET LOCAL ROLE app_user`, que es lo único que hace
 * honesto a un test de RLS: el rol que conecta Testcontainers es superusuario y
 * los superusuarios siempre ignoran las políticas, de modo que sin cambiar de
 * rol estas comprobaciones pasarían aunque no hubiera ni una escrita.
 *
 * Escenario: Ana es dueña de su workspace y Bruno es miembro; Carla no comparte
 * nada con nadie. `appAbierta` está en WORKSPACE_WRITE —Bruno la edita— y
 * `appPrivada` es de Ana y solo suya.
 */
let appAbierta: string;
let appPrivada: string;
let docAbierta: string;
let plantillaDeAna: string;
let agenteAbierto: string;

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

  const [doc] = await db.db
    .insert(documents)
    .values({ appId: appAbierta, type: 'VISION' })
    .returning({ id: documents.id });
  docAbierta = doc!.id;

  const [plantilla] = await db.db
    .insert(agentTemplates)
    .values({
      workspaceId: e.wsAna,
      name: 'Product Owner',
      handle: 'po',
      iconEmoji: '🎯',
      iconColor: 'amber',
      prompt: 'Ask what problem this solves.',
      createdBy: e.ana,
    })
    .returning({ id: agentTemplates.id });
  plantillaDeAna = plantilla!.id;

  const [instancia] = await db.db
    .insert(agents)
    .values({
      appId: appAbierta,
      templateId: plantillaDeAna,
      name: 'Product Owner',
      handle: 'po',
      iconEmoji: '🎯',
      iconColor: 'amber',
      addedBy: e.ana,
    })
    .returning({ id: agents.id });
  agenteAbierto = instancia!.id;

  await db.db.insert(agents).values({
    appId: appPrivada,
    name: 'Tech Lead',
    handle: 'techlead',
    iconEmoji: '🛠️',
    iconColor: 'slate',
    addedBy: e.ana,
  });
}, 180_000);

afterAll(async () => {
  await db.stop();
});

async function fallo(fn: () => Promise<unknown>): Promise<unknown> {
  return fn().then(
    () => null,
    (error: unknown) => error,
  );
}

describe('quién ve las plantillas', () => {
  it('cualquier miembro del workspace, porque sin verlas no puede instanciar ninguna', async () => {
    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(agentTemplates));
    expect(vistas).toHaveLength(1);
  });

  it('un extraño no ve ninguna', async () => {
    const vistas = await asAppUser(db.db, e.carla, (tx) => tx.select().from(agentTemplates));
    expect(vistas).toHaveLength(0);
  });

  it('sin identidad tampoco se ve nada: el defecto es no ver', async () => {
    const vistas = await asAppUser(db.db, null, (tx) => tx.select().from(agentTemplates));
    expect(vistas).toHaveLength(0);
  });
});

describe('quién las escribe', () => {
  const nueva = (workspaceId: string, handle: string) => ({
    workspaceId,
    name: 'Marketing',
    handle,
    iconEmoji: '📣',
    iconColor: 'violet',
    prompt: 'Who would hear about this, and how?',
  });

  it('el dueño del workspace', async () => {
    await expect(
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(agentTemplates).values(nueva(e.wsAna, 'marketing')),
      ),
    ).resolves.not.toThrow();
  });

  it('un miembro que no es dueño, no: crear una plantilla es cosa suya', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(agentTemplates).values(nueva(e.wsAna, 'de-bruno')),
      ),
    );
    expect(error).not.toBeNull();
  });

  it('ni editar la que hay', async () => {
    await asAppUser(db.db, e.bruno, (tx) =>
      tx
        .update(agentTemplates)
        .set({ prompt: 'Reescrito por quien no debe.' })
        .where(eq(agentTemplates.id, plantillaDeAna)),
    );

    const [sigue] = await db.db
      .select()
      .from(agentTemplates)
      .where(eq(agentTemplates.id, plantillaDeAna));
    expect(sigue!.prompt).toBe('Ask what problem this solves.');
  });

  it('ser dueño de un workspace no da la mano en el de al lado', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) => tx.insert(agentTemplates).values(nueva(e.wsAna, 'colada'))),
    );
    expect(error).not.toBeNull();
  });
});

describe('quién ve los agentes', () => {
  it('quien ve la app los ve', async () => {
    const vistos = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(agents));
    expect(vistos).toHaveLength(1);
    expect(vistos[0]!.appId).toBe(appAbierta);
  });

  it('los de una app privada, solo su precursor', async () => {
    const deAna = await asAppUser(db.db, e.ana, (tx) => tx.select().from(agents));
    expect(deAna).toHaveLength(2);
  });

  it('un extraño no ve ninguno', async () => {
    const vistos = await asAppUser(db.db, e.carla, (tx) => tx.select().from(agents));
    expect(vistos).toHaveLength(0);
  });
});

describe('quién los añade y los retira', () => {
  const nuevo = (appId: string, handle: string) => ({
    appId,
    name: 'Devil’s Advocate',
    handle,
    iconEmoji: '😈',
    iconColor: 'rose',
  });

  it('quien puede editar la app, aunque sea un invitado', async () => {
    await expect(
      asAppUser(db.db, e.bruno, (tx) => tx.insert(agents).values(nuevo(appAbierta, 'abogado'))),
    ).resolves.not.toThrow();
  });

  it('sobre una app que no ve, no, ni acertando su identificador', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.bruno, (tx) => tx.insert(agents).values(nuevo(appPrivada, 'colado'))),
    );
    expect(error).not.toBeNull();
  });

  it('retirarlo es editar la app: un extraño no puede', async () => {
    await asAppUser(db.db, e.carla, (tx) =>
      tx
        .update(agents)
        .set({ removedAt: new Date(), active: false })
        .where(eq(agents.id, agenteAbierto)),
    );

    const [sigue] = await db.db.select().from(agents).where(eq(agents.id, agenteAbierto));
    expect(sigue!.removedAt).toBeNull();
  });
});

describe('las revisiones del prompt', () => {
  it('las lee quien ve el agente', async () => {
    await db.db
      .insert(agentPromptRevisions)
      .values({ agentId: agenteAbierto, revision: 1, prompt: 'Ask what problem this solves.' });

    const vistas = await asAppUser(db.db, e.bruno, (tx) => tx.select().from(agentPromptRevisions));
    expect(vistas).toHaveLength(1);
  });

  it('un extraño no lee ninguna: el perfil es de la app', async () => {
    const vistas = await asAppUser(db.db, e.carla, (tx) => tx.select().from(agentPromptRevisions));
    expect(vistas).toHaveLength(0);
  });

  it('las añade quien puede editar la app', async () => {
    await expect(
      asAppUser(db.db, e.bruno, (tx) =>
        tx
          .insert(agentPromptRevisions)
          .values({ agentId: agenteAbierto, revision: 2, prompt: 'And for whom.' }),
      ),
    ).resolves.not.toThrow();
  });

  it('y nadie las reescribe, ni quien puede editar', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx
          .update(agentPromptRevisions)
          .set({ prompt: 'Reescrito.' })
          .where(eq(agentPromptRevisions.agentId, agenteAbierto)),
      ),
    );
    expect(error).not.toBeNull();
  });
});

describe('las menciones que invocan', () => {
  let comentarioDeBruno: string;

  beforeAll(async () => {
    const [hilo] = await db.db
      .insert(commentThreads)
      .values({ appId: appAbierta, documentId: docAbierta, kind: 'GENERAL', createdBy: e.bruno })
      .returning({ id: commentThreads.id });

    const [suyo] = await db.db
      .insert(comments)
      .values({ threadId: hilo!.id, body: '@po ¿esto se sostiene?', authorId: e.bruno })
      .returning({ id: comments.id });
    comentarioDeBruno = suyo!.id;
  });

  it('se invoca desde un comentario propio', async () => {
    await expect(
      asAppUser(db.db, e.bruno, (tx) =>
        tx.insert(commentAgentMentions).values({
          commentId: comentarioDeBruno,
          agentId: agenteAbierto,
        }),
      ),
    ).resolves.not.toThrow();
  });

  it('no desde el comentario de otro: invocar cuesta tokens ajenos', async () => {
    await db.db.delete(commentAgentMentions).where(eq(commentAgentMentions.agentId, agenteAbierto));

    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(commentAgentMentions).values({
          commentId: comentarioDeBruno,
          agentId: agenteAbierto,
        }),
      ),
    );
    expect(error).not.toBeNull();
  });
});

describe('lo que ninguna política permite todavía', () => {
  it('la aplicación no puede escribir un comentario a nombre de un agente', async () => {
    const [hilo] = await db.db
      .select({ id: commentThreads.id })
      .from(commentThreads)
      .where(eq(commentThreads.appId, appAbierta));
    const [revision] = await db.db
      .select({ id: agentPromptRevisions.id })
      .from(agentPromptRevisions)
      .where(eq(agentPromptRevisions.agentId, agenteAbierto));

    /*
     * Es el estado deseado mientras no exista quien deba hacerlo: las políticas
     * de `comments` exigen `author_id = current_app_user()`, y un comentario de
     * agente lo tiene nulo. Abrir esta puerta es una decisión de BE, y este
     * test está aquí para que abrirla sin querer se note.
     */
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.insert(comments).values({
          threadId: hilo!.id,
          body: 'Escrito por un agente.',
          authorAgentId: agenteAbierto,
          agentPromptRevisionId: revision!.id,
        }),
      ),
    );
    expect(error).not.toBeNull();
  });
});

describe('el canario: las tablas nuevas tienen RLS activada y forzada', () => {
  it('las cuatro', async () => {
    const filas = await db.db.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      sql`SELECT relname, relrowsecurity, relforcerowsecurity
          FROM pg_class
          WHERE relname IN ('agent_templates', 'agents', 'agent_prompt_revisions',
                            'comment_agent_mentions')
          ORDER BY relname`,
    );

    expect(filas.rows).toEqual([
      { relname: 'agent_prompt_revisions', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'agent_templates', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'agents', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'comment_agent_mentions', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
