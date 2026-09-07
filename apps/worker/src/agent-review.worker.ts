import { UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import {
  AGENT_REVIEW_MAX_OUTPUT_TOKENS,
  AGENT_REVIEW_QUEUE,
  type AgentReviewJob,
  agentFailureReason,
  agentReviewMessages,
  agentReviewSchema,
  agentReviewSystemPrompt,
  createAnchor,
  isRetryable,
  ProviderError,
  ProviderErrorKind,
  reviewCancelKey,
  type ReviewOutput,
} from '@app-foundry/core';
import {
  agentPromptRevisions,
  agentReviewRuns,
  agentReviews,
  agents,
  apps,
  type Database,
  documentVersions,
  workspaceMembers,
} from '@app-foundry/db';
import type { Env } from '@app-foundry/env';
import type { Emision, EventoRevision } from '@app-foundry/notifications';
import { conIdentidad, currentTx } from '@app-foundry/platform';

/**
 * El consumidor de `ai-review`: el abanico (RF-1606, TRD §11.2).
 *
 * Un trabajo por agente. Cada uno hace tres cosas, y en tres transacciones
 * distintas a propósito:
 *
 *  1. **Se anuncia**: comprueba que la revisión sigue viva y se marca en curso.
 *  2. **Lee y piensa**, fuera de toda transacción. Es lo que dura minutos, y
 *     mantener una abierta mientras tanto inmoviliza una conexión y le impide
 *     al motor limpiar detrás de nadie.
 *  3. **Escribe todo de una vez**: sus hilos, sus comentarios y su cambio de
 *     estado en una sola transacción (T-33). Un reintento encuentra la
 *     ejecución terminada y no repite; una caída a mitad no deja medio hilo.
 */
export interface AgentReviewDeps {
  readonly redis: Redis;
  readonly db: Database;
  readonly env: Env;
  readonly log: Logger;
  readonly ask: (peticion: {
    readonly workspaceId: string;
    readonly appId: string;
    readonly actorUserId: string;
    readonly agentId: string;
    readonly system: string;
    readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
    readonly schema: Record<string, unknown>;
    readonly maxOutputTokens: number;
    readonly signal?: AbortSignal;
  }) => Promise<{ salida: ReviewOutput; provider: string; modelId: string }>;
  readonly notify: (aviso: Emision) => Promise<unknown>;
  /** Reparte el progreso a quien esté mirando esa app (RF-1609). */
  readonly progreso: (userIds: readonly string[], evento: EventoRevision) => Promise<void>;
}

/** Por qué una ejecución no llegó a escribir. Ninguna es un error. */
type Motivo =
  | 'la revisión ya no está en marcha'
  | 'la revisión se canceló'
  | 'esta ejecución ya había terminado'
  | 'el agente ya no está activo'
  | 'ya no hay versión que revisar'
  | 'el modelo no devolvió nada que anclar';

/** Lo que hace falta para pedirle a un agente que lea. */
interface Encargo {
  workspaceId: string;
  appId: string;
  appName: string;
  appDescription: string | null;
  agentHandle: string;
  promptRevisionId: string;
  prompt: string;
  replyWordLimit: number;
  versionId: string;
  contenido: string;
  reviewId: string;
}

export function startAgentReviewWorker(deps: AgentReviewDeps): Worker<AgentReviewJob> {
  const worker = new Worker<AgentReviewJob>(
    AGENT_REVIEW_QUEUE,
    async (job) => {
      const motivo = await revisar(deps, job.data).catch((error: unknown) => {
        throw comoFalla(error);
      });
      if (motivo) {
        deps.log.log(`el agente no revisa (${job.id ?? '?'}): ${motivo}`);
      }
    },
    {
      connection: deps.redis,
      concurrency: deps.env.AI_WORKER_CONCURRENCY,
      /*
       * El ritmo se acota **por proveedor** y no solo por número de trabajos
       * (RNF-705): cinco agentes de una revisión salen a la vez contra el mismo
       * proveedor, y sin freno se llevan por delante su límite de tasa y de
       * paso al asistente de escritura de otro workspace.
       */
      limiter: {
        max: deps.env.AI_REVIEW_MAX_PER_INTERVAL,
        duration: deps.env.AI_REVIEW_INTERVAL_MS,
      },
      settings: { backoffStrategy: (intento) => Math.min(1_000 * 2 ** intento, 30_000) },
    },
  );

  worker.on('failed', (job, error) => {
    deps.log.error(`revisión de agente fallida (${job?.id ?? '?'}): ${cadenaDeCausas(error)}`);
    if (!job) return;

    const intentos = job.opts.attempts ?? 1;
    if (!(error instanceof UnrecoverableError) && job.attemptsMade < intentos) return;

    void cerrarEjecucionFallida(deps, job.data, agentFailureReason(motivoDelProveedor(error)));
  });

  return worker;
}

/**
 * Lo que hace un agente en una revisión.
 *
 * Devuelve un motivo en vez de lanzar cuando sencillamente no debe leer: no es
 * un fallo del sistema y no tiene que ensuciar el registro ni provocar
 * reintentos.
 */
async function revisar(deps: AgentReviewDeps, trabajo: AgentReviewJob): Promise<Motivo | null> {
  if (await cancelada(deps, trabajo.reviewId)) {
    await cerrarEjecucion(deps, trabajo, 'CANCELLED', 0);
    return 'la revisión se canceló';
  }

  /* 1 · Se anuncia, con una transacción corta. */
  const encargo = await conIdentidad(
    deps.db,
    trabajo.actorUserId,
    () => prepararse(trabajo),
    alFallarElReparto(deps),
  );
  if (typeof encargo === 'string') return encargo;

  await publicar(deps, trabajo);

  /* 2 · Lee y piensa. Fuera de transacción: esto dura. */
  const corte = new AbortController();
  const vigilante = setInterval(() => {
    void cancelada(deps, trabajo.reviewId).then((si) => {
      if (si) corte.abort();
    });
  }, 2_000);

  let respuesta;
  try {
    respuesta = await deps.ask({
      workspaceId: encargo.workspaceId,
      appId: encargo.appId,
      actorUserId: trabajo.actorUserId,
      agentId: trabajo.agentId,
      system: agentReviewSystemPrompt(papel(encargo, deps.env)),
      messages: agentReviewMessages(papel(encargo, deps.env)),
      schema: agentReviewSchema(deps.env.AI_MAX_REVIEW_THREADS_PER_AGENT),
      maxOutputTokens: AGENT_REVIEW_MAX_OUTPUT_TOKENS,
      signal: corte.signal,
    });
  } finally {
    clearInterval(vigilante);
  }

  /*
   * 3 · Antes de escribir, se vuelve a mirar si sigue viva.
   *
   * Si se canceló mientras leía, lo generado **no se publica**. Ya está pagado
   * y da pena tirarlo, pero quien pulsó «parar» y ve aparecer comentarios diez
   * segundos después no vuelve a fiarse del botón: lo escrito se queda, lo que
   * no llegó a escribirse no aparece (RF-1610).
   */
  if (await cancelada(deps, trabajo.reviewId)) {
    await cerrarEjecucion(deps, trabajo, 'CANCELLED', 0);
    return 'la revisión se canceló';
  }

  const escritos = await conIdentidad(
    deps.db,
    trabajo.actorUserId,
    () => escribir(deps, trabajo, encargo, respuesta),
    alFallarElReparto(deps),
  );

  await publicar(deps, trabajo);
  await avisar(deps, trabajo, encargo, escritos);

  return escritos === 0 ? 'el modelo no devolvió nada que anclar' : null;
}

/** El contexto del papel, que se arma igual para el prompt y para el material. */
function papel(encargo: Encargo, env: Env) {
  return {
    profile: encargo.prompt,
    handle: encargo.agentHandle,
    appName: encargo.appName,
    appDescription: encargo.appDescription,
    document: encargo.contenido,
    maxFindings: env.AI_MAX_REVIEW_THREADS_PER_AGENT,
    replyWordLimit: encargo.replyWordLimit,
  };
}

/**
 * Comprueba que esta ejecución sigue teniendo sentido y la marca en curso.
 *
 * Todo se vuelve a mirar aquí y no solo al encolar: entre una cosa y otra
 * pueden pasar minutos, y en ese hueco a la revisión la pueden haber cancelado
 * o al agente pausado.
 */
async function prepararse(trabajo: AgentReviewJob): Promise<Encargo | Motivo> {
  const tx = currentTx();

  const [contexto] = await tx
    .select({
      reviewStatus: agentReviews.status,
      versionId: agentReviews.versionId,
      runStatus: agentReviewRuns.status,
      workspaceId: apps.workspaceId,
      appName: apps.name,
      appDescription: apps.shortDescription,
      agentHandle: agents.handle,
      agentActive: agents.active,
      agentRemovedAt: agents.removedAt,
      replyWordLimit: agents.replyWordLimit,
    })
    .from(agentReviewRuns)
    .innerJoin(agentReviews, eq(agentReviews.id, agentReviewRuns.reviewId))
    .innerJoin(apps, eq(apps.id, agentReviews.appId))
    .innerJoin(agents, eq(agents.id, agentReviewRuns.agentId))
    .where(eq(agentReviewRuns.id, trabajo.runId));

  if (!contexto) return 'la revisión ya no está en marcha';
  if (contexto.reviewStatus === 'CANCELLED') return 'la revisión se canceló';
  if (contexto.reviewStatus === 'DONE' || contexto.reviewStatus === 'FAILED') {
    return 'la revisión ya no está en marcha';
  }
  /* Idempotencia: un reintento encuentra su ejecución terminada (T-33). */
  if (contexto.runStatus !== 'QUEUED') return 'esta ejecución ya había terminado';
  if (!contexto.agentActive || contexto.agentRemovedAt !== null) {
    return 'el agente ya no está activo';
  }

  const [version] = await tx
    .select({ id: documentVersions.id, content: documentVersions.content })
    .from(documentVersions)
    .where(eq(documentVersions.id, contexto.versionId));
  if (!version) return 'ya no hay versión que revisar';

  const [perfil] = await tx
    .select({ id: agentPromptRevisions.id, prompt: agentPromptRevisions.prompt })
    .from(agentPromptRevisions)
    .where(eq(agentPromptRevisions.agentId, trabajo.agentId))
    .orderBy(sql`${agentPromptRevisions.revision} DESC`)
    .limit(1);
  if (!perfil) return 'el agente ya no está activo';

  /* La revisión entera arranca con el primero que llega. */
  await tx
    .update(agentReviews)
    .set({ status: 'RUNNING', startedAt: new Date() })
    .where(and(eq(agentReviews.id, trabajo.reviewId), eq(agentReviews.status, 'QUEUED')));

  await tx
    .update(agentReviewRuns)
    .set({ status: 'RUNNING', startedAt: new Date() })
    .where(eq(agentReviewRuns.id, trabajo.runId));

  return {
    workspaceId: contexto.workspaceId,
    appId: trabajo.appId,
    appName: contexto.appName,
    appDescription: contexto.appDescription,
    agentHandle: contexto.agentHandle,
    promptRevisionId: perfil.id,
    prompt: perfil.prompt,
    replyWordLimit: contexto.replyWordLimit,
    versionId: version.id,
    contenido: version.content,
    reviewId: trabajo.reviewId,
  };
}

/**
 * Escribe lo que el agente encontró, todo en la misma transacción (T-33).
 *
 * Cada cita se busca **literalmente** en el documento. La que no aparece se
 * descarta: un modelo que cita «casi» igual —una tilde, unas comillas— es lo
 * normal, y anclar por aproximación colgaría el comentario de un fragmento
 * parecido sin que quien lo lee pueda saberlo (D-13). Se prefiere perder un
 * comentario a ponerlo donde no va.
 */
async function escribir(
  deps: AgentReviewDeps,
  trabajo: AgentReviewJob,
  encargo: Encargo,
  respuesta: { salida: ReviewOutput; provider: string; modelId: string },
): Promise<number> {
  const tx = currentTx();
  let escritos = 0;
  let descartadas = 0;

  for (const hallazgo of respuesta.salida.findings) {
    const donde = encargo.contenido.indexOf(hallazgo.quote);
    if (donde === -1 || hallazgo.quote.trim().length === 0) {
      descartadas += 1;
      continue;
    }

    const ancla = createAnchor(encargo.contenido, donde, donde + hallazgo.quote.length);
    if (!ancla) {
      descartadas += 1;
      continue;
    }

    const [hilo] = (
      await tx.execute<{ agent_open_thread: string }>(
        sql`SELECT agent_open_thread(
              cast(${encargo.appId} as uuid),
              cast(${trabajo.agentId} as uuid),
              cast(${encargo.reviewId} as uuid),
              'INLINE'::thread_kind,
              cast(${ancla.quote} as text),
              cast(${ancla.prefix} as text),
              cast(${ancla.suffix} as text),
              ${ancla.start}::int,
              ${ancla.end}::int,
              cast(${encargo.versionId} as uuid))`,
      )
    ).rows;

    await escribirComentario(
      trabajo,
      encargo,
      hilo!.agent_open_thread,
      hallazgo.comment,
      respuesta,
    );
    escritos += 1;
  }

  /* Y la valoración de conjunto, como hilo general (RF-1606). */
  if (respuesta.salida.overall.trim().length > 0) {
    const [general] = (
      await tx.execute<{ agent_open_thread: string }>(
        sql`SELECT agent_open_thread(
              cast(${encargo.appId} as uuid),
              cast(${trabajo.agentId} as uuid),
              cast(${encargo.reviewId} as uuid),
              'GENERAL'::thread_kind)`,
      )
    ).rows;

    await escribirComentario(
      trabajo,
      encargo,
      general!.agent_open_thread,
      respuesta.salida.overall,
      respuesta,
    );
    escritos += 1;
  }

  if (descartadas > 0) {
    deps.log.warn(
      `revisión ${trabajo.reviewId}: ${String(descartadas)} citas descartadas por no aparecer literalmente`,
    );
  }

  await tx
    .update(agentReviewRuns)
    .set({ status: 'DONE', threadsWritten: escritos, finishedAt: new Date() })
    .where(eq(agentReviewRuns.id, trabajo.runId));

  await cerrarSiEsLaUltima(trabajo.reviewId);
  return escritos;
}

async function escribirComentario(
  trabajo: AgentReviewJob,
  encargo: Encargo,
  threadId: string,
  cuerpo: string,
  respuesta: { provider: string; modelId: string },
): Promise<void> {
  await currentTx().execute(
    sql`SELECT agent_write_comment(
          cast(${threadId} as uuid),
          cast(${trabajo.agentId} as uuid),
          cast(${encargo.promptRevisionId} as uuid),
          cast(${cuerpo} as text),
          NULL::uuid,
          cast(${respuesta.provider} as ai_provider),
          cast(${respuesta.modelId} as text),
          NULL::text)`,
  );
}

/**
 * Cierra la revisión cuando ya no queda nadie leyendo (RF-1609).
 *
 * La cierra quien termina el último, mire como mire su propio resultado: una
 * ejecución fallida no puede dejar la revisión colgada en `RUNNING` para
 * siempre, porque eso bloquearía la app entera por el único parcial que impide
 * dos revisiones a la vez. `FAILED` solo si fallaron todas: con una sola que
 * escribiera, la revisión sirvió para algo.
 */
async function cerrarSiEsLaUltima(reviewId: string): Promise<void> {
  const pendientes = await currentTx()
    .select({ id: agentReviewRuns.id })
    .from(agentReviewRuns)
    .where(
      and(
        eq(agentReviewRuns.reviewId, reviewId),
        sql`${agentReviewRuns.status} IN ('QUEUED', 'RUNNING')`,
      ),
    );
  if (pendientes.length > 0) return;

  const conExito = await currentTx()
    .select({ id: agentReviewRuns.id })
    .from(agentReviewRuns)
    .where(and(eq(agentReviewRuns.reviewId, reviewId), eq(agentReviewRuns.status, 'DONE')));

  await currentTx()
    .update(agentReviews)
    .set({ status: conExito.length > 0 ? 'DONE' : 'FAILED', finishedAt: new Date() })
    .where(
      and(eq(agentReviews.id, reviewId), sql`${agentReviews.status} IN ('QUEUED', 'RUNNING')`),
    );
}

/** Marca una ejecución que no llegó a escribir, y cierra la revisión si toca. */
async function cerrarEjecucion(
  deps: AgentReviewDeps,
  trabajo: AgentReviewJob,
  estado: 'CANCELLED' | 'FAILED',
  escritos: number,
): Promise<void> {
  try {
    await conIdentidad(
      deps.db,
      trabajo.actorUserId,
      async () => {
        await currentTx()
          .update(agentReviewRuns)
          .set({ status: estado, threadsWritten: escritos, finishedAt: new Date() })
          .where(
            and(
              eq(agentReviewRuns.id, trabajo.runId),
              sql`${agentReviewRuns.status} IN ('QUEUED', 'RUNNING')`,
            ),
          );

        await cerrarSiEsLaUltima(trabajo.reviewId);
      },
      alFallarElReparto(deps),
    );

    await publicar(deps, trabajo);
  } catch (error) {
    deps.log.error(`no se pudo cerrar la ejecución: ${cadenaDeCausas(error)}`);
  }
}

/** Lo mismo, y además se lo cuenta a quien pidió la revisión (RF-1615). */
async function cerrarEjecucionFallida(
  deps: AgentReviewDeps,
  trabajo: AgentReviewJob,
  causa: string,
): Promise<void> {
  await cerrarEjecucion(deps, trabajo, 'FAILED', 0);

  try {
    await conIdentidad(
      deps.db,
      trabajo.actorUserId,
      async () => {
        const [contexto] = await currentTx()
          .select({
            workspaceId: apps.workspaceId,
            appName: apps.name,
            agentHandle: agents.handle,
          })
          .from(apps)
          .innerJoin(agents, eq(agents.id, trabajo.agentId))
          .where(eq(apps.id, trabajo.appId));
        if (!contexto) return;

        await deps.notify({
          type: 'AI_AGENT_FAILED',
          entorno: { actor: '', destinatario: trabajo.actorUserId },
          workspaceId: contexto.workspaceId,
          appId: trabajo.appId,
          payload: {
            actorHandle: contexto.agentHandle,
            appName: contexto.appName,
            message: `it could not finish its review: ${causa}`,
            byAgent: true,
          },
        });
      },
      alFallarElReparto(deps),
    );
  } catch (error) {
    deps.log.error(`no se pudo avisar del fallo de la revisión: ${cadenaDeCausas(error)}`);
  }
}

/**
 * Avisa de que hay comentarios nuevos, una vez por ejecución.
 *
 * Una revisión de cinco agentes con cinco hilos cada uno son veinticinco
 * comentarios: un aviso por comentario dejaría la campana inservible. Uno por
 * agente y con el número dentro dice lo mismo sin enterrar lo demás.
 */
async function avisar(
  deps: AgentReviewDeps,
  trabajo: AgentReviewJob,
  encargo: Encargo,
  escritos: number,
): Promise<void> {
  if (escritos === 0) return;

  await conIdentidad(
    deps.db,
    trabajo.actorUserId,
    async () => {
      await deps.notify({
        type: 'APP_COMMENTED',
        entorno: { actor: '', precursor: trabajo.actorUserId },
        workspaceId: encargo.workspaceId,
        appId: trabajo.appId,
        payload: {
          actorHandle: encargo.agentHandle,
          appName: encargo.appName,
          excerpt: `left ${String(escritos)} comments reviewing ${encargo.appName}`,
          byAgent: true,
        },
      });
    },
    alFallarElReparto(deps),
  );
}

/** Cómo va la revisión, para quien esté mirando esa app (RF-1609). */
async function publicar(deps: AgentReviewDeps, trabajo: AgentReviewJob): Promise<void> {
  try {
    const evento = await conIdentidad(
      deps.db,
      trabajo.actorUserId,
      async () => {
        const [revision] = await currentTx()
          .select({ status: agentReviews.status })
          .from(agentReviews)
          .where(eq(agentReviews.id, trabajo.reviewId));
        if (!revision) return null;

        const runs = await currentTx()
          .select({ status: agentReviewRuns.status })
          .from(agentReviewRuns)
          .where(eq(agentReviewRuns.reviewId, trabajo.reviewId));

        /*
         * La audiencia se resuelve aquí y no en el repartidor: saber quién ve
         * una app es una consulta a la base, y el canal no tiene por qué
         * conocer el modelo. Una app privada la ve su precursor y nadie más.
         */
        const [app] = await currentTx()
          .select({
            workspaceId: apps.workspaceId,
            accessLevel: apps.accessLevel,
            precursorId: apps.precursorId,
          })
          .from(apps)
          .where(eq(apps.id, trabajo.appId));
        if (!app) return null;

        const audiencia =
          app.accessLevel === 'PRIVATE'
            ? [app.precursorId]
            : (
                await currentTx()
                  .select({ userId: workspaceMembers.userId })
                  .from(workspaceMembers)
                  .where(eq(workspaceMembers.workspaceId, app.workspaceId))
              ).map((f) => f.userId);

        return {
          audiencia,
          evento: {
            kind: 'review' as const,
            reviewId: trabajo.reviewId,
            appId: trabajo.appId,
            status: revision.status,
            done: runs.filter((r) => r.status !== 'QUEUED' && r.status !== 'RUNNING').length,
            total: runs.length,
          },
        };
      },
      alFallarElReparto(deps),
    );

    if (evento) await deps.progreso(evento.audiencia, evento.evento);
  } catch (error) {
    /* Que el progreso no llegue no puede tumbar la revisión: se ve al recargar. */
    deps.log.warn(`no se pudo repartir el progreso: ${cadenaDeCausas(error)}`);
  }
}

async function cancelada(deps: AgentReviewDeps, reviewId: string): Promise<boolean> {
  try {
    return (await deps.redis.exists(reviewCancelKey(reviewId))) === 1;
  } catch {
    /* Sin Redis no se puede saber, y parar de más es peor que seguir. */
    return false;
  }
}

function alFallarElReparto(deps: AgentReviewDeps): (error: unknown) => void {
  return (error) => {
    deps.log.error(`el aviso se guardó pero no se pudo repartir: ${cadenaDeCausas(error)}`);
  };
}

function comoFalla(error: unknown): Error {
  if (error instanceof ProviderError && !isRetryable(error.kind)) {
    return Object.assign(new UnrecoverableError(`${error.kind}: sin reintento`), { cause: error });
  }
  if (error instanceof ProviderError && error.kind === ProviderErrorKind.CANCELLED) {
    return Object.assign(new UnrecoverableError('cancelado'), { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

function motivoDelProveedor(error: unknown): ProviderErrorKind | null {
  let actual: unknown = error;
  while (actual !== null && actual !== undefined) {
    if (actual instanceof ProviderError) return actual.kind;
    actual = (actual as { cause?: unknown }).cause;
  }
  return null;
}

function cadenaDeCausas(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = actual.cause;
  }
  return partes.join(' ← ') || String(error);
}
