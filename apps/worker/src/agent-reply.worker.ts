import { UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  AGENT_REPLY_QUEUE,
  agentMaySpeak,
  AGENT_REPLY_MAX_OUTPUT_TOKENS,
  AGENT_REPLY_OUT_OF_ROOM,
  agentReplyMessages,
  agentSystemPrompt,
  type AgentReplyJob,
  AgentTrigger,
  isRetryable,
  ProviderError,
  ProviderErrorKind,
  type ThreadEntry,
} from '@app-foundry/core';
import {
  agentPromptRevisions,
  agents,
  apps,
  comments,
  commentThreads,
  type Database,
  documents,
  documentVersions,
  users,
} from '@app-foundry/db';
import type { Env } from '@app-foundry/env';
import type { Emision } from '@app-foundry/notifications';
import { conIdentidad, currentTx } from '@app-foundry/platform';

/**
 * El consumidor de `ai:agent-reply` (RF-1602, TRD §11.2).
 *
 * Cada trabajo hace tres cosas, en este orden y por este motivo:
 *
 *  1. **Comprueba** que el disparo sigue siendo válido. Entre encolar y
 *     ejecutar pueden pasar segundos o minutos, y en ese hueco al agente lo
 *     pueden haber desactivado, retirado, o puede haber agotado sus turnos.
 *     Comprobar al encolar y no al ejecutar dejaría hablar a quien ya no debe.
 *  2. **Pregunta** al modelo, por el paso común de invocación, con su cupo y su
 *     registro.
 *  3. **Escribe**, por la única puerta que existe, en la misma transacción.
 *
 * Todo se hace con la identidad de quien provocó el disparo. Un agente no ve
 * nada que no viera quien le habló: el aislamiento es el de siempre y no uno
 * nuevo en el que haya que confiar.
 */
export interface AgentReplyDeps {
  readonly redis: Redis;
  readonly db: Database;
  readonly env: Env;
  readonly log: Logger;
  /**
   * Cómo se le pregunta al modelo.
   *
   * Se inyecta en vez de construirse aquí para que el worker se pueda ejercitar
   * de punta a punta sin proveedor: es el mismo motivo por el que existe el
   * proveedor de mentira (T-36).
   */
  /**
   * Cómo se avisa a las personas del hilo.
   *
   * Se inyecta igual que `ask`, y por lo mismo: el worker no tiene por qué
   * conocer el emisor concreto, y así se puede ejercitar sin uno.
   */
  readonly notify: (aviso: Emision) => Promise<unknown>;
  readonly ask: (peticion: {
    readonly workspaceId: string;
    readonly appId: string;
    readonly actorUserId: string;
    readonly agentId: string;
    readonly system: string;
    readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
    readonly maxOutputTokens: number;
  }) => Promise<{ texto: string; razonamiento: string; provider: string; modelId: string }>;
}

/** Por qué un trabajo no llegó a escribir nada. Ninguna es un error. */
type Motivo =
  | 'el agente ya no está activo'
  | 'el hilo ya no existe'
  | 'el comentario que lo provocó ya no está'
  | 'lo provocó un agente, y un agente no dispara a nadie'
  | 'ha agotado sus turnos en este hilo'
  | 'ya había respondido a ese comentario'
  | 'el modelo no devolvió nada';

export function startAgentReplyWorker(deps: AgentReplyDeps): Worker<AgentReplyJob> {
  const worker = new Worker<AgentReplyJob>(
    AGENT_REPLY_QUEUE,
    async (job) => {
      const motivo = await responder(deps, job.data).catch((error: unknown) => {
        throw comoFalla(error);
      });
      if (motivo) {
        /*
         * Callarse es un desenlace legítimo y frecuente —el tope de turnos, un
         * agente retirado—, así que se registra como información y no como
         * fallo: un trabajo «fallido» invitaría a reintentarlo, y reintentar
         * un silencio deliberado sería empeñarse.
         */
        deps.log.log(`el agente no responde (${job.id ?? '?'}): ${motivo}`);
      }
    },
    {
      connection: deps.redis,
      concurrency: deps.env.AI_WORKER_CONCURRENCY,
      /*
       * El reintento lo decide la taxonomía de errores, no BullMQ: aquí solo se
       * fija el techo. Lo que no merece reintento se lanza como
       * `UnrecoverableError` y muere en el primer intento (RNF-703).
       */
      settings: { backoffStrategy: (intento) => Math.min(1_000 * 2 ** intento, 30_000) },
    },
  );

  worker.on('failed', (job, error) => {
    deps.log.error(`trabajo de agente fallido (${job?.id ?? '?'}): ${cadenaDeCausas(error)}`);
  });

  return worker;
}

/**
 * Responde, o dice por qué no.
 *
 * Devuelve un motivo en vez de lanzar cuando el agente simplemente no debe
 * hablar: no es un fallo del sistema y no tiene que ensuciar el registro de
 * errores ni provocar reintentos.
 */
async function responder(deps: AgentReplyDeps, trabajo: AgentReplyJob): Promise<Motivo | null> {
  /*
   * `conIdentidad` y no una transacción a pelo: además de fijar la identidad,
   * entra en el contexto que `currentTx()` lee. Sin eso, todo lo que este
   * worker reutiliza de la API —el paso común de invocación, el emisor de
   * avisos— consulta fuera de transacción y falla en la primera línea. Se vio
   * ejecutándolo, no compilando.
   */
  return conIdentidad(deps.db, trabajo.actorUserId, async () => {
    const tx = currentTx();

    const [contexto] = await tx
      .select({
        appId: commentThreads.appId,
        appName: apps.name,
        appDescription: apps.shortDescription,
        workspaceId: apps.workspaceId,
        agentHandle: agents.handle,
        agentWordLimit: agents.replyWordLimit,
        agentActive: agents.active,
        agentRemovedAt: agents.removedAt,
      })
      .from(commentThreads)
      .innerJoin(apps, eq(apps.id, commentThreads.appId))
      .innerJoin(agents, eq(agents.id, trabajo.agentId))
      .where(eq(commentThreads.id, trabajo.threadId));

    if (!contexto) return 'el hilo ya no existe';
    if (!contexto.agentActive || contexto.agentRemovedAt !== null) {
      return 'el agente ya no está activo';
    }

    /*
     * El cortafuegos de RF-1604, en la condición de entrada y no en el prompt
     * (T-35). Se vuelve a comprobar aquí y no solo al encolar porque es la
     * única comprobación que no puede fallar: si un día alguien encola desde
     * otro sitio, este sigue en pie.
     */
    const [disparador] = await tx
      .select({ authorId: comments.authorId, threadId: comments.threadId })
      .from(comments)
      .where(eq(comments.id, trabajo.triggerCommentId));

    if (!disparador) return 'el comentario que lo provocó ya no está';
    if (disparador.authorId === null) return 'lo provocó un agente, y un agente no dispara a nadie';

    /* Un agente responde una vez a lo que le dijeron, aunque se encole dos (T-33). */
    const [yaRespondio] = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.threadId, trabajo.threadId),
          eq(comments.authorAgentId, trabajo.agentId),
          eq(comments.parentId, trabajo.triggerCommentId),
        ),
      );
    if (yaRespondio) return 'ya había respondido a ese comentario';

    /* El tope de turnos, con su salvedad: una mención explícita lo levanta. */
    const [turnos] = await tx
      .select({ cuantos: sql<number>`count(*)::int` })
      .from(comments)
      .where(
        and(eq(comments.threadId, trabajo.threadId), eq(comments.authorAgentId, trabajo.agentId)),
      );

    const puedeHablar = agentMaySpeak({
      turnsTaken: turnos?.cuantos ?? 0,
      limit: deps.env.AI_MAX_AGENT_TURNS_PER_THREAD,
      explicitlyMentioned: trabajo.trigger === AgentTrigger.MENTION,
    });
    if (!puedeHablar) return 'ha agotado sus turnos en este hilo';

    const [perfil] = await tx
      .select({ id: agentPromptRevisions.id, prompt: agentPromptRevisions.prompt })
      .from(agentPromptRevisions)
      .where(eq(agentPromptRevisions.agentId, trabajo.agentId))
      .orderBy(desc(agentPromptRevisions.revision))
      .limit(1);
    if (!perfil) return 'el agente ya no está activo';

    const documento = await versionActual(contexto.appId);
    const hilo = await conversacion(trabajo.threadId, trabajo.agentId);

    const contextoDeLlamada = {
      profile: perfil.prompt,
      handle: contexto.agentHandle,
      appName: contexto.appName,
      appDescription: contexto.appDescription,
      document: documento,
      thread: hilo,
      /* Lo que se le pidió de largo a este agente; 0 es sin límite (RF-1516). */
      replyWordLimit: contexto.agentWordLimit,
    };

    const respuesta = await deps.ask({
      workspaceId: contexto.workspaceId,
      appId: contexto.appId,
      actorUserId: trabajo.actorUserId,
      agentId: trabajo.agentId,
      system: agentSystemPrompt(contextoDeLlamada),
      messages: agentReplyMessages(contextoDeLlamada),
      maxOutputTokens: AGENT_REPLY_MAX_OUTPUT_TOKENS,
    });

    const texto = respuesta.texto.trim();
    /*
     * Si se quedó sin sitio pensando, se dice.
     *
     * Callar dejaba a quien preguntó mirando un hilo donde no pasaba nada, sin
     * forma de distinguir «se lo está pensando» de «se ha roto algo», y tirando
     * de paso el razonamiento, que es justo lo que explica qué ocurrió. Con
     * deliberación pero sin respuesta se publica el aviso y se conserva lo
     * pensado, plegado como siempre.
     *
     * Sin ninguna de las dos cosas no hay nada que contar, y ahí sí se calla.
     */
    const cuerpo = texto.length > 0 ? texto : AGENT_REPLY_OUT_OF_ROOM;
    if (texto.length === 0 && respuesta.razonamiento.trim().length === 0) {
      return 'el modelo no devolvió nada';
    }

    /*
     * La escritura va en esta misma transacción, con el perfil con el que se
     * generó. Si algo falla después, no queda medio comentario ni un trabajo
     * dado por hecho: o las dos cosas o ninguna (T-33).
     */
    const [escrito] = (
      await tx.execute<{ agent_write_comment: string }>(
        sql`SELECT agent_write_comment(
            cast(${trabajo.threadId} as uuid),
            cast(${trabajo.agentId} as uuid),
            cast(${perfil.id} as uuid),
            cast(${cuerpo} as text),
            cast(${trabajo.triggerCommentId} as uuid),
            cast(${respuesta.provider} as ai_provider),
            cast(${respuesta.modelId} as text),
            cast(${respuesta.razonamiento} as text))`,
      )
    ).rows;

    await avisar(deps, {
      commentId: escrito!.agent_write_comment,
      trabajo,
      appId: contexto.appId,
      workspaceId: contexto.workspaceId,
      agentHandle: contexto.agentHandle,
      appName: contexto.appName,
      texto: cuerpo,
    });

    return null;
  });
}

/** El contenido de la versión actual, o nulo si todavía no hay ninguna. */
async function versionActual(appId: string): Promise<string | null> {
  const [fila] = await currentTx()
    .select({ contenido: documentVersions.content })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')));

  return fila?.contenido ?? null;
}

/**
 * El hilo entero, como se le presenta al agente.
 *
 * Los borrados se saltan: su texto no se envía a nadie, ni siquiera a un
 * modelo. Y se dice quién escribió cada cosa, incluido si fue otra IA: un
 * agente no reacciona a otro (RF-1604), pero sí tiene que poder leer lo que hay
 * sin creer que se lo dijo una persona.
 */
async function conversacion(threadId: string, agentId: string): Promise<ThreadEntry[]> {
  const filas = await currentTx()
    .select({
      body: comments.body,
      deletedAt: comments.deletedAt,
      authorAgentId: comments.authorAgentId,
      handle: users.handle,
      agentHandle: agents.handle,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(agents, eq(agents.id, comments.authorAgentId))
    .where(and(eq(comments.threadId, threadId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt));

  return filas.map((fila) => ({
    author: fila.authorAgentId ? (fila.agentHandle ?? 'agent') : (fila.handle ?? 'someone'),
    mine: fila.authorAgentId === agentId,
    byAgent: fila.authorAgentId !== null,
    body: fila.body,
  }));
}

/**
 * El error con toda su cadena de causas.
 *
 * Sin esto, un fallo de base de datos llega envuelto en el «Failed query» de
 * Drizzle y el mensaje de Postgres —el que dice qué restricción saltó— se queda
 * dentro, invisible. Se aprendió mirando un fallo que solo decía que la consulta
 * había fallado.
 */
function cadenaDeCausas(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = actual.cause;
  }
  return partes.join(' | ');
}

/** Lo que no merece reintento muere en el primer intento (RNF-703). */
function comoFalla(error: unknown): Error {
  if (error instanceof ProviderError && !isRetryable(error.kind)) {
    return new UnrecoverableError(`${error.kind}: sin reintento`);
  }
  if (error instanceof ProviderError && error.kind === ProviderErrorKind.CANCELLED) {
    return new UnrecoverableError('cancelado');
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Avisa a las personas del hilo de que un agente ha contestado (RF-1612).
 *
 * Un agente **no recibe** avisos: no tiene sesión ni bandeja, así que la
 * audiencia se calcula solo con personas. Y quien provocó la respuesta sí
 * entra, al revés que cuando actúa una persona: si menciono a un agente, lo que
 * quiero saber es justamente que ha contestado.
 *
 * Por eso el actor va vacío. `audiencia` excluye siempre al actor de su propio
 * aviso (RF-905), y aquí el actor es el agente, que no está en ninguna lista:
 * dejarlo vacío no salta ninguna regla, solo dice que no lo hizo una persona.
 */
async function avisar(
  deps: AgentReplyDeps,
  datos: {
    commentId: string;
    trabajo: AgentReplyJob;
    appId: string;
    workspaceId: string;
    agentHandle: string;
    appName: string;
    texto: string;
  },
): Promise<void> {
  const [hilo] = await currentTx()
    .select({ autor: commentThreads.createdBy })
    .from(commentThreads)
    .where(eq(commentThreads.id, datos.trabajo.threadId));

  /* Personas y solo personas: un agente no es destinatario de nada (RF-1612). */
  const participantes = await currentTx()
    .selectDistinct({ userId: comments.authorId })
    .from(comments)
    .where(and(eq(comments.threadId, datos.trabajo.threadId), isNotNull(comments.authorId)));

  /* Quienes han pedido no oír a este agente en concreto (RF-1612). */
  const callados = await currentTx().execute<{ user_id: string }>(
    sql`SELECT user_id FROM notification_agent_muted_by(cast(${datos.trabajo.agentId} as uuid))`,
  );

  await deps.notify({
    type: 'THREAD_REPLIED',
    entorno: {
      actor: '',
      autorDelHilo: hilo?.autor ?? null,
      participantesDelHilo: participantes
        .map((p) => p.userId)
        .filter((id): id is string => id !== null),
    },
    workspaceId: datos.workspaceId,
    appId: datos.appId,
    threadId: datos.trabajo.threadId,
    payload: {
      actorHandle: datos.agentHandle,
      appName: datos.appName,
      excerpt: datos.texto.slice(0, 140),
      byAgent: true,
    },
    silenciados: callados.rows.map((f) => f.user_id),
  });
}
