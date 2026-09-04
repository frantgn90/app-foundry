import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
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
 * Lo que el motor garantiza de las plantillas, ejercitado contra un Postgres de
 * verdad.
 *
 * Aquí no se prueba quién puede hacer qué —eso es aislamiento, y llega con su
 * propia migración—: se prueba la **forma**, que es lo que esta migración
 * promete. Se siembra como superusuario, igual que el resto del escenario, para
 * que ninguna política estorbe a lo que se quiere medir.
 */
/** Una app de Ana y otra de Bruno, para cruzar workspaces cuando haga falta. */
let appAna: string;
let appBruno: string;

beforeAll(async () => {
  db = await startTestDb();
  e = await seed(db.db);

  const [deAna] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsAna,
      slug: 'vision',
      name: 'Visión',
      precursorId: e.ana,
      accessLevel: 'WORKSPACE_READ',
      iconEmoji: '💡',
      iconColor: 'teal',
    })
    .returning({ id: apps.id });
  appAna = deAna!.id;

  const [deBruno] = await db.db
    .insert(apps)
    .values({
      workspaceId: e.wsBruno,
      slug: 'ajena',
      name: 'Ajena',
      precursorId: e.bruno,
      accessLevel: 'WORKSPACE_READ',
      iconEmoji: '📦',
      iconColor: 'slate',
    })
    .returning({ id: apps.id });
  appBruno = deBruno!.id;
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

/** Un agente mínimo, sin molde: instanciar desde uno se prueba aparte. */
function agente(appId: string, handle: string) {
  return {
    appId,
    name: 'Product Owner',
    handle,
    iconEmoji: '🎯',
    iconColor: 'amber',
    addedBy: e.ana,
  };
}

/** El mensaje del error de Postgres, que Drizzle envuelve en su «Failed query». */
function mensajeDe(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = actual.cause;
  }
  return partes.join(' | ');
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

describe('el handle de un agente', () => {
  it('no se repite entre los que siguen en la app', async () => {
    await db.db.insert(agents).values(agente(appAna, 'po'));

    const error = await fallo(() => db.db.insert(agents).values(agente(appAna, 'po')));
    expect(error).not.toBeNull();
  });

  it('tampoco cambiando las mayúsculas', async () => {
    const error = await fallo(() => db.db.insert(agents).values(agente(appAna, 'PO')));
    expect(error).not.toBeNull();
  });

  it('se libera al retirarlo, en vez de quedar quemado para siempre', async () => {
    await db.db
      .update(agents)
      .set({ removedAt: new Date(), active: false })
      .where(and(eq(agents.appId, appAna), eq(agents.handle, 'po')));

    await expect(db.db.insert(agents).values(agente(appAna, 'po'))).resolves.not.toThrow();
  });

  it('y el retirado sigue ahí, con su nombre, para lo que escribiera', async () => {
    const retirados = await db.db
      .select()
      .from(agents)
      .where(and(eq(agents.appId, appAna), isNotNull(agents.removedAt)));
    expect(retirados).toHaveLength(1);
    expect(retirados[0]!.handle).toBe('po');
  });

  it('se repite sin problema en otra app: cada una tiene los suyos', async () => {
    await expect(db.db.insert(agents).values(agente(appBruno, 'po'))).resolves.not.toThrow();
  });
});

describe('de qué plantilla desciende', () => {
  it('de una de su propio workspace, sí', async () => {
    const [plantillaAna] = await db.db
      .insert(agentTemplates)
      .values(plantilla(e.wsAna, 'para-instanciar'))
      .returning({ id: agentTemplates.id });

    await expect(
      db.db.insert(agents).values({ ...agente(appAna, 'con-molde'), templateId: plantillaAna!.id }),
    ).resolves.not.toThrow();
  });

  it('de una de otro workspace, no, aunque se acierte el identificador', async () => {
    const [plantillaBruno] = await db.db
      .insert(agentTemplates)
      .values(plantilla(e.wsBruno, 'ajena'))
      .returning({ id: agentTemplates.id });

    const error = await fallo(() =>
      db.db
        .insert(agents)
        .values({ ...agente(appAna, 'molde-ajeno'), templateId: plantillaBruno!.id }),
    );
    /*
     * Se mira el mensaje y no solo que haya fallado: sin esto, el test pasaría
     * igual si lo rechazara cualquier otra cosa —una clave ajena, un único— y
     * dejaría de probar lo que dice probar.
     */
    expect(mensajeDe(error)).toContain('another workspace template');
  });

  it('borrar la plantilla deja al agente sin molde, pero no se lo lleva', async () => {
    const [molde] = await db.db
      .insert(agentTemplates)
      .values(plantilla(e.wsAna, 'efimera'))
      .returning({ id: agentTemplates.id });
    await db.db.insert(agents).values({ ...agente(appAna, 'huerfano'), templateId: molde!.id });

    await db.db.delete(agentTemplates).where(eq(agentTemplates.id, molde!.id));

    const [sobrevive] = await db.db
      .select()
      .from(agents)
      .where(and(eq(agents.appId, appAna), eq(agents.handle, 'huerfano')));
    expect(sobrevive).toBeDefined();
    expect(sobrevive!.templateId).toBeNull();
  });
});

describe('las dos formas de callar', () => {
  it('desactivar es reversible y no retira a nadie', async () => {
    const [creado] = await db.db
      .insert(agents)
      .values(agente(appAna, 'en-pausa'))
      .returning({ id: agents.id });

    await db.db.update(agents).set({ active: false }).where(eq(agents.id, creado!.id));
    await db.db.update(agents).set({ active: true }).where(eq(agents.id, creado!.id));

    const [vuelto] = await db.db.select().from(agents).where(eq(agents.id, creado!.id));
    expect(vuelto!.active).toBe(true);
    expect(vuelto!.removedAt).toBeNull();
  });

  it('retirar sin apagar no se admite: sería un retirado que sigue contestando', async () => {
    const [creado] = await db.db
      .insert(agents)
      .values(agente(appAna, 'retirada-a-medias'))
      .returning({ id: agents.id });

    const error = await fallo(() =>
      db.db.update(agents).set({ removedAt: new Date() }).where(eq(agents.id, creado!.id)),
    );
    expect(mensajeDe(error)).toContain('agents_retired_is_inactive_check');
  });

  it('ni nacer retirado y activo a la vez', async () => {
    const error = await fallo(() =>
      db.db.insert(agents).values({ ...agente(appAna, 'imposible'), removedAt: new Date() }),
    );
    expect(mensajeDe(error)).toContain('agents_retired_is_inactive_check');
  });

  it('retirar es un solo movimiento: fecha y bandera juntas', async () => {
    const [creado] = await db.db
      .insert(agents)
      .values(agente(appAna, 'despedido'))
      .returning({ id: agents.id });

    await db.db
      .update(agents)
      .set({ removedAt: new Date(), active: false })
      .where(eq(agents.id, creado!.id));

    const [retirado] = await db.db.select().from(agents).where(eq(agents.id, creado!.id));
    expect(retirado!.removedAt).not.toBeNull();
    expect(retirado!.active).toBe(false);
    /* Y sigue ahí: retirar no borra (RF-1509). */
    expect(retirado!.name).toBe('Product Owner');
  });
});

describe('el prompt, versión a versión', () => {
  let elAgente: string;

  beforeAll(async () => {
    const [creado] = await db.db
      .insert(agents)
      .values(agente(appAna, 'con-prompt'))
      .returning({ id: agents.id });
    elAgente = creado!.id;

    await db.db.insert(agentPromptRevisions).values([
      { agentId: elAgente, revision: 1, prompt: 'Ask what problem this solves.', createdBy: e.ana },
      { agentId: elAgente, revision: 2, prompt: 'And for whom, exactly.', createdBy: e.ana },
    ]);
  });

  it('el vigente es el de número más alto', async () => {
    const [vigente] = await db.db
      .select()
      .from(agentPromptRevisions)
      .where(eq(agentPromptRevisions.agentId, elAgente))
      .orderBy(desc(agentPromptRevisions.revision))
      .limit(1);
    expect(vigente!.revision).toBe(2);
    expect(vigente!.prompt).toBe('And for whom, exactly.');
  });

  it('el anterior sigue legible: es de donde cuelga lo que ya se escribió', async () => {
    const todas = await db.db
      .select()
      .from(agentPromptRevisions)
      .where(eq(agentPromptRevisions.agentId, elAgente));
    expect(todas).toHaveLength(2);
  });

  it('no se repite el número dentro del mismo agente', async () => {
    const error = await fallo(() =>
      db.db
        .insert(agentPromptRevisions)
        .values({ agentId: elAgente, revision: 2, prompt: 'Otra vez la dos.' }),
    );
    expect(error).not.toBeNull();
  });

  it('la numeración empieza en uno: no hay revisión cero ni negativa', async () => {
    const error = await fallo(() =>
      db.db
        .insert(agentPromptRevisions)
        .values({ agentId: elAgente, revision: 0, prompt: 'Antes del principio.' }),
    );
    expect(mensajeDe(error)).toContain('agent_prompt_revisions_positive_check');
  });

  it('la aplicación no puede reescribir una revisión, solo añadir otra', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx
          .update(agentPromptRevisions)
          .set({ prompt: 'Reescrito a posteriori.' })
          .where(eq(agentPromptRevisions.agentId, elAgente)),
      ),
    );
    /* Falla por permiso, no por una política: el UPDATE no está concedido. */
    expect(mensajeDe(error)).toContain('permission denied');
  });

  it('ni borrarla', async () => {
    const error = await fallo(() =>
      asAppUser(db.db, e.ana, (tx) =>
        tx.delete(agentPromptRevisions).where(eq(agentPromptRevisions.agentId, elAgente)),
      ),
    );
    expect(mensajeDe(error)).toContain('permission denied');
  });
});

describe('quién firma un comentario', () => {
  let documento: string;
  let unAgente: string;
  let suPerfil: string;

  beforeAll(async () => {
    const [doc] = await db.db
      .insert(documents)
      .values({ appId: appAna, type: 'VISION' })
      .returning({ id: documents.id });
    documento = doc!.id;

    const [creado] = await db.db
      .insert(agents)
      .values(agente(appAna, 'firmante'))
      .returning({ id: agents.id });
    unAgente = creado!.id;

    const [revision] = await db.db
      .insert(agentPromptRevisions)
      .values({ agentId: unAgente, revision: 1, prompt: 'Be blunt about scope.' })
      .returning({ id: agentPromptRevisions.id });
    suPerfil = revision!.id;
  });

  /** Un hilo abierto por quien se diga, para colgarle comentarios. */
  async function hilo(de: { persona?: string; agente?: string }): Promise<string> {
    const [creado] = await db.db
      .insert(commentThreads)
      .values({
        appId: appAna,
        documentId: documento,
        kind: 'GENERAL',
        createdBy: de.persona ?? null,
        createdByAgentId: de.agente ?? null,
      })
      .returning({ id: commentThreads.id });
    return creado!.id;
  }

  it('una persona, como siempre', async () => {
    const suyo = await hilo({ persona: e.ana });
    await expect(
      db.db.insert(comments).values({ threadId: suyo, body: 'Lo de siempre.', authorId: e.ana }),
    ).resolves.not.toThrow();
  });

  it('o un agente, con el perfil con el que escribió', async () => {
    const suyo = await hilo({ agente: unAgente });
    await expect(
      db.db.insert(comments).values({
        threadId: suyo,
        body: 'Scope looks wider than the problem.',
        authorAgentId: unAgente,
        agentPromptRevisionId: suPerfil,
      }),
    ).resolves.not.toThrow();
  });

  it('nadie, no: un comentario sin autor no se sabe a quién responde', async () => {
    const suyo = await hilo({ persona: e.ana });
    const error = await fallo(() =>
      db.db.insert(comments).values({ threadId: suyo, body: 'De nadie.' }),
    );
    expect(mensajeDe(error)).toContain('comments_single_author_check');
  });

  it('los dos a la vez, tampoco: no se podría creer', async () => {
    const suyo = await hilo({ persona: e.ana });
    const error = await fallo(() =>
      db.db.insert(comments).values({
        threadId: suyo,
        body: 'De dos.',
        authorId: e.ana,
        authorAgentId: unAgente,
        agentPromptRevisionId: suPerfil,
      }),
    );
    expect(mensajeDe(error)).toContain('comments_single_author_check');
  });

  it('un agente sin su perfil deja RF-1510 sin respuesta', async () => {
    const suyo = await hilo({ agente: unAgente });
    const error = await fallo(() =>
      db.db
        .insert(comments)
        .values({ threadId: suyo, body: 'Sin perfil.', authorAgentId: unAgente }),
    );
    expect(mensajeDe(error)).toContain('comments_agent_prompt_pair_check');
  });

  it('y un perfil colgando de una persona no significa nada', async () => {
    const suyo = await hilo({ persona: e.ana });
    const error = await fallo(() =>
      db.db.insert(comments).values({
        threadId: suyo,
        body: 'Perfil de más.',
        authorId: e.ana,
        agentPromptRevisionId: suPerfil,
      }),
    );
    expect(mensajeDe(error)).toContain('comments_agent_prompt_pair_check');
  });

  it('lo mismo vale para el hilo: ni sin autor ni con dos', async () => {
    const sinNadie = await fallo(() => hilo({}));
    expect(mensajeDe(sinNadie)).toContain('comment_threads_single_author_check');

    const conDos = await fallo(() => hilo({ persona: e.ana, agente: unAgente }));
    expect(mensajeDe(conDos)).toContain('comment_threads_single_author_check');
  });

  it('retirar al agente no borra lo que escribió, y sigue firmado por él', async () => {
    await db.db
      .update(agents)
      .set({ removedAt: new Date(), active: false })
      .where(eq(agents.id, unAgente));

    const suyos = await db.db.select().from(comments).where(eq(comments.authorAgentId, unAgente));
    expect(suyos.length).toBeGreaterThan(0);
    expect(suyos[0]!.agentPromptRevisionId).toBe(suPerfil);
  });

  it('ni se le puede borrar de la tabla mientras haya algo suyo escrito', async () => {
    const error = await fallo(() => db.db.delete(agents).where(eq(agents.id, unAgente)));
    /*
     * Salta el hilo antes que el comentario, porque este agente abrió los dos y
     * Postgres comprueba en el orden que quiere. Da igual cuál de las dos
     * claves lo pare: lo que se comprueba es que borrarlo a mano no se puede
     * mientras quede rastro suyo (RF-1509).
     */
    expect(mensajeDe(error)).toContain('violates foreign key constraint');
    expect(mensajeDe(error)).toContain('agents');
  });
});

describe('a quién se puede invocar con una mención', () => {
  let documento: string;
  let elAgente: string;
  let suPerfil: string;
  let hiloDeAna: string;

  beforeAll(async () => {
    const [doc] = await db.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.appId, appAna));
    documento = doc!.id;

    const [creado] = await db.db
      .insert(agents)
      .values(agente(appAna, 'invocable'))
      .returning({ id: agents.id });
    elAgente = creado!.id;

    const [revision] = await db.db
      .insert(agentPromptRevisions)
      .values({ agentId: elAgente, revision: 1, prompt: 'Answer when called.' })
      .returning({ id: agentPromptRevisions.id });
    suPerfil = revision!.id;

    const [hilo] = await db.db
      .insert(commentThreads)
      .values({ appId: appAna, documentId: documento, kind: 'GENERAL', createdBy: e.ana })
      .returning({ id: commentThreads.id });
    hiloDeAna = hilo!.id;
  });

  async function comentarioDe(quien: { persona?: string; agente?: string }): Promise<string> {
    const [creado] = await db.db
      .insert(comments)
      .values({
        threadId: hiloDeAna,
        body: 'Hola @invocable',
        authorId: quien.persona ?? null,
        authorAgentId: quien.agente ?? null,
        agentPromptRevisionId: quien.agente ? suPerfil : null,
      })
      .returning({ id: comments.id });
    return creado!.id;
  }

  it('una persona invoca a un agente de su app', async () => {
    const suyo = await comentarioDe({ persona: e.ana });
    await expect(
      db.db.insert(commentAgentMentions).values({ commentId: suyo, agentId: elAgente }),
    ).resolves.not.toThrow();
  });

  it('un agente no invoca a nadie, aunque lo escriba en su texto', async () => {
    const suyo = await comentarioDe({ agente: elAgente });
    const error = await fallo(() =>
      db.db.insert(commentAgentMentions).values({ commentId: suyo, agentId: elAgente }),
    );
    expect(mensajeDe(error)).toContain('Only a person can summon an agent');
  });

  it('ni a un agente de otra app, aunque se acierte su identificador', async () => {
    const [ajeno] = await db.db
      .insert(agents)
      .values(agente(appBruno, 'de-otra-app'))
      .returning({ id: agents.id });

    const suyo = await comentarioDe({ persona: e.ana });
    const error = await fallo(() =>
      db.db.insert(commentAgentMentions).values({ commentId: suyo, agentId: ajeno!.id }),
    );
    expect(mensajeDe(error)).toContain('does not belong to this app');
  });

  it('la mención muere con su comentario, que es de donde salía', async () => {
    const suyo = await comentarioDe({ persona: e.ana });
    await db.db.insert(commentAgentMentions).values({ commentId: suyo, agentId: elAgente });

    await db.db.execute(sql`DELETE FROM comments WHERE id = ${suyo}::uuid`);

    const quedan = await db.db
      .select()
      .from(commentAgentMentions)
      .where(eq(commentAgentMentions.commentId, suyo));
    expect(quedan).toHaveLength(0);
  });
});

describe('lo que arrastra el workspace', () => {
  it('borrarlo se lleva sus plantillas y sus agentes: no son de nadie más', async () => {
    expect((await db.db.select().from(agentTemplates)).length).toBeGreaterThan(0);
    expect((await db.db.select().from(agents)).length).toBeGreaterThan(0);

    await db.db.execute(sql`DELETE FROM workspaces WHERE id = ${e.wsBruno}::uuid`);

    const plantillas = await db.db.select().from(agentTemplates);
    expect(plantillas.every((p) => p.workspaceId !== e.wsBruno)).toBe(true);

    const quedan = await db.db.select().from(agents);
    expect(quedan.every((a) => a.appId !== appBruno)).toBe(true);
  });
});
