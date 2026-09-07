import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import {
  AGENT_REVIEW_MAX_OUTPUT_TOKENS,
  agentReviewMessages,
  agentReviewSystemPrompt,
  AiTask,
} from '@app-foundry/core';
import {
  agentPromptRevisions,
  agentReviewRuns,
  agentReviews,
  agents,
  apps,
  documents,
  documentVersions,
  users,
} from '@app-foundry/db';
import type { Env } from '@app-foundry/env';
import {
  AiInvocationService,
  AiProviderAccessService,
  AiQuotaService,
} from '@app-foundry/ai-runtime';
import { currentTx, DATABASE, ENV } from '@app-foundry/platform';
import type { Database } from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { ReviewQueueService } from './review-queue.service.js';
import type { ReviewAgentEstimateDto, ReviewDto, ReviewEstimateDto } from './reviews.dto.js';

/** Lo que hace falta saber de la app para decidir si se puede revisar. */
interface AppParaRevisar {
  id: string;
  workspaceId: string;
  archivedAt: Date | null;
}

/** Un agente activo con su perfil vigente, listo para que se le estime. */
interface AgenteParaRevisar {
  id: string;
  handle: string;
  name: string;
  prompt: string;
  replyWordLimit: number;
}

/**
 * La revisión en abanico: los agentes de la app leyendo la visión (RF-1606).
 *
 * De momento solo sabe **cuánto costaría**. Lanzarla y cancelarla llegan con la
 * cola, en BJ.
 *
 * Quién puede: cualquiera que **lea** la app (RF-1608, D-12). Es la única
 * escritura del modelo de agentes que no exige poder editar, y es deliberado:
 * pedir que te lean no cambia nada del documento, y quien solo tiene lectura es
 * justamente quien más necesita una segunda opinión.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly invocations: AiInvocationService,
    private readonly providers: AiProviderAccessService,
    private readonly quota: AiQuotaService,
    private readonly cola: ReviewQueueService,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * El techo de tokens de una revisión que todavía no se ha pedido (RF-1207).
   *
   * Se cuenta **de verdad** la entrada de cada agente, no una media: el
   * documento es el mismo para todos pero el perfil no, y sobre todo porque una
   * cifra que se queda corta es peor que no enseñar ninguna. La salida va al
   * máximo que la tarea permite generar, que es lo que la convierte en techo.
   *
   * Cuesta una llamada al proveedor por agente, y aun así sale más barato que
   * la sorpresa: quien confirma un número y recibe una factura mayor no vuelve
   * a confiar en el número.
   */
  async estimate(appId: string, userId: string): Promise<ReviewEstimateDto> {
    const app = await this.appRevisable(appId);
    const version = await this.versionActual(appId);
    const activos = await this.agentesActivos(appId);

    const porAgente: ReviewAgentEstimateDto[] = [];
    let provider = '';
    let modelId = '';

    for (const agente of activos) {
      const techo = await this.invocations.estimate(
        { workspaceId: app.workspaceId, appId, task: AiTask.AGENT_REVIEW, userId },
        [
          {
            label: 'agent-review',
            request: {
              system: agentReviewSystemPrompt(this.contexto(agente, app, version.content)),
              messages: agentReviewMessages(this.contexto(agente, app, version.content)),
              maxOutputTokens: AGENT_REVIEW_MAX_OUTPUT_TOKENS,
            },
          },
        ],
      );

      provider = techo.plan.provider;
      modelId = techo.plan.modelId;
      porAgente.push({
        agentId: agente.id,
        handle: agente.handle,
        name: agente.name,
        estimatedTokens: techo.estimatedTokens,
      });
    }

    const totalTokens = porAgente.reduce((suma, uno) => suma + uno.estimatedTokens, 0);
    const restante = await this.restanteDelCupo(app.workspaceId, provider);

    return {
      agents: porAgente,
      totalTokens,
      provider,
      modelId,
      versionNo: version.versionNo,
      versionId: version.id,
      /* Sin cupo puesto no hay techo que romper, así que cabe (RF-1204). */
      fitsInQuota: restante === null || totalTokens <= restante,
      remainingTokens: restante,
    };
  }

  /**
   * Lanza la revisión: una fila por agente y un trabajo por fila (RF-1606).
   *
   * Vuelve a estimar en vez de fiarse de lo que el cliente confirmó. Cuesta
   * otra vuelta de conteo y es lo único honesto: entre ver el número y decir
   * que sí pueden haber pasado minutos, haberse gastado el cupo o haberse
   * pausado un agente, y quien decide si esto arranca es el servidor.
   */
  async start(appId: string, userId: string): Promise<ReviewDto> {
    const techo = await this.estimate(appId, userId);

    /*
     * Si no cabe, no arranca: ni a medias ni «los que quepan» (RF-1207). Media
     * revisión es lo peor de los dos mundos —se ha gastado y no se ha leído
     * entera— y deja al que la pidió sin saber qué falta.
     */
    if (!techo.fitsInQuota) {
      throw new ConflictException(
        `This review needs ${String(techo.totalTokens)} tokens and only ` +
          `${String(techo.remainingTokens ?? 0)} are left this month. It will not start`,
      );
    }

    const [creada] = await currentTx()
      .insert(agentReviews)
      .values({
        appId,
        requestedBy: userId,
        versionId: techo.versionId,
        estimatedTokens: techo.totalTokens,
      })
      .onConflictDoNothing()
      .returning({ id: agentReviews.id });

    /*
     * Sin fila es que ya hay una viva: lo dice el único parcial del motor y no
     * una consulta previa, que dejaría una carrera entre mirar y escribir cuyo
     * precio es pagar dos revisiones del mismo documento (RF-1609).
     */
    if (!creada) {
      throw new ConflictException('There is already a review running on this app');
    }

    const ejecuciones = await currentTx()
      .insert(agentReviewRuns)
      .values(
        techo.agents.map((agente) => ({
          reviewId: creada.id,
          agentId: agente.agentId,
          idempotencyKey: `${creada.id}:${agente.agentId}`,
        })),
      )
      .returning({ id: agentReviewRuns.id, agentId: agentReviewRuns.agentId });

    this.cola.encolar(
      ejecuciones.map((ejecucion) => ({
        reviewId: creada.id,
        runId: ejecucion.id,
        appId,
        agentId: ejecucion.agentId,
        actorUserId: userId,
      })),
    );

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_REVIEW_REQUESTED,
      resourceType: 'agent_review',
      resourceId: creada.id,
      workspaceId: (await this.appRevisable(appId)).workspaceId,
      /* Cuántos y cuánto, nunca qué dice el documento (RF-1703). */
      metadata: {
        appId,
        agents: techo.agents.length,
        estimatedTokens: techo.totalTokens,
      },
    });

    return this.byId(appId, creada.id, userId);
  }

  /**
   * Cancela una revisión en marcha (RF-1610).
   *
   * Lo ya escrito se queda: son comentarios de pleno derecho y borrarlos por
   * haber parado la revisión sería tirar trabajo que alguien puede estar
   * leyendo. Lo que no ha empezado, no empieza.
   */
  async cancel(appId: string, reviewId: string, userId: string): Promise<ReviewDto> {
    const revision = await this.byId(appId, reviewId, userId);

    if (revision.status !== 'QUEUED' && revision.status !== 'RUNNING') {
      throw new ConflictException('That review is not running any more');
    }

    /*
     * Quién puede pararla lo decide la política del motor: si no es de quien
     * llama ni es el precursor de la app, el UPDATE no toca ninguna fila. Se
     * comprueba el resultado para poder decirlo con un 403 en vez de con un
     * «no ha pasado nada» (RNF-102).
     */
    const parada = await currentTx()
      .update(agentReviews)
      .set({ status: 'CANCELLED', finishedAt: new Date() })
      .where(eq(agentReviews.id, reviewId))
      .returning({ id: agentReviews.id });

    if (parada.length === 0) {
      throw new ForbiddenException('Only whoever asked for it, or the app precursor, can stop it');
    }

    /* Lo que aún no ha empezado se cierra aquí; lo que corre lo corta el worker. */
    await currentTx()
      .update(agentReviewRuns)
      .set({ status: 'CANCELLED', finishedAt: new Date() })
      .where(and(eq(agentReviewRuns.reviewId, reviewId), eq(agentReviewRuns.status, 'QUEUED')));

    this.cola.cancelar(
      reviewId,
      revision.runs.map((r) => r.agentId),
    );

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_REVIEW_CANCELLED,
      resourceType: 'agent_review',
      resourceId: reviewId,
      workspaceId: (await this.appRevisable(appId)).workspaceId,
      metadata: { appId },
    });

    return this.byId(appId, reviewId, userId);
  }

  /**
   * La revisión que hay que enseñar en la ficha de la app.
   *
   * La viva si la hay, y si no la última: lo primero es lo que impide lanzar
   * otra y lo segundo es lo que explica de dónde salieron los hilos que se
   * están leyendo (RF-1609).
   */
  async current(appId: string, userId: string): Promise<ReviewDto | null> {
    await this.appVisible(appId);

    const [fila] = await currentTx()
      .select({ id: agentReviews.id })
      .from(agentReviews)
      .where(eq(agentReviews.appId, appId))
      .orderBy(desc(agentReviews.createdAt))
      .limit(1);

    return fila ? this.byId(appId, fila.id, userId) : null;
  }

  private async byId(appId: string, reviewId: string, userId: string): Promise<ReviewDto> {
    const [revision] = await currentTx()
      .select({
        id: agentReviews.id,
        status: agentReviews.status,
        estimatedTokens: agentReviews.estimatedTokens,
        createdAt: agentReviews.createdAt,
        finishedAt: agentReviews.finishedAt,
        requestedBy: agentReviews.requestedBy,
        requestedByHandle: users.handle,
        versionNo: documentVersions.versionNo,
        versionId: documentVersions.id,
        precursorId: apps.precursorId,
      })
      .from(agentReviews)
      .innerJoin(users, eq(users.id, agentReviews.requestedBy))
      .innerJoin(documentVersions, eq(documentVersions.id, agentReviews.versionId))
      .innerJoin(apps, eq(apps.id, agentReviews.appId))
      .where(and(eq(agentReviews.id, reviewId), eq(agentReviews.appId, appId)));

    if (!revision) throw new NotFoundException('That review does not exist');

    const runs = await currentTx()
      .select({
        agentId: agentReviewRuns.agentId,
        handle: agents.handle,
        name: agents.name,
        status: agentReviewRuns.status,
        threadsWritten: agentReviewRuns.threadsWritten,
      })
      .from(agentReviewRuns)
      .innerJoin(agents, eq(agents.id, agentReviewRuns.agentId))
      .where(eq(agentReviewRuns.reviewId, reviewId))
      .orderBy(asc(agents.handle));

    const viva = revision.status === 'QUEUED' || revision.status === 'RUNNING';

    return {
      id: revision.id,
      status: revision.status,
      requestedByHandle: revision.requestedByHandle,
      canCancel: viva && (revision.requestedBy === userId || revision.precursorId === userId),
      versionNo: revision.versionNo,
      versionId: revision.versionId,
      estimatedTokens: revision.estimatedTokens,
      runs,
      done: runs.filter((r) => r.status !== 'QUEUED' && r.status !== 'RUNNING').length,
      createdAt: revision.createdAt.toISOString(),
      finishedAt: revision.finishedAt?.toISOString() ?? null,
    };
  }

  /** Que la app se vea basta para mirar sus revisiones. */
  private async appVisible(appId: string): Promise<void> {
    const [app] = await currentTx().select({ id: apps.id }).from(apps).where(eq(apps.id, appId));
    if (!app) throw new NotFoundException('That app does not exist');
  }

  /**
   * Lo que queda del cupo del mes, contando lo ya reservado.
   *
   * Reservado y no solo gastado: cinco agentes de otra revisión en curso tienen
   * su techo apartado aunque todavía no lo hayan consumido, y prometerle ese
   * hueco a alguien más es la forma de que las dos se queden a medias.
   */
  private async restanteDelCupo(workspaceId: string, provider: string): Promise<number | null> {
    if (provider === '') return null;

    const cupo = await this.providers.quotaOf(workspaceId, provider as never);
    if (cupo === null) return null;

    const estado = await this.quota.state(
      { workspaceId, provider: provider as never },
      cupo,
      Date.now(),
    );
    return Math.max(0, cupo - estado.spent - estado.reserved);
  }

  private contexto(
    agente: AgenteParaRevisar,
    app: AppParaRevisar & { name: string; shortDescription: string | null },
    documento: string,
  ) {
    return {
      profile: agente.prompt,
      handle: agente.handle,
      appName: app.name,
      appDescription: app.shortDescription,
      document: documento,
      maxFindings: this.env.AI_MAX_REVIEW_THREADS_PER_AGENT,
      replyWordLimit: agente.replyWordLimit,
    };
  }

  /**
   * La app, si quien pregunta la ve y admite gasto.
   *
   * La RLS ya escondería lo que no se puede ver; el 404 dice lo justo sin
   * confirmar que exista (RNF-102). Una app archivada no admite gasto nuevo,
   * como no admite ningún otro cambio (RF-409).
   */
  private async appRevisable(
    appId: string,
  ): Promise<AppParaRevisar & { name: string; shortDescription: string | null }> {
    const [app] = await currentTx()
      .select({
        id: apps.id,
        workspaceId: apps.workspaceId,
        name: apps.name,
        shortDescription: apps.shortDescription,
        archivedAt: apps.archivedAt,
      })
      .from(apps)
      .where(eq(apps.id, appId));

    if (!app) throw new NotFoundException('That app does not exist');
    if (app.archivedAt !== null) throw new ForbiddenException('This app is archived');
    return app;
  }

  /**
   * La versión actual, que es sobre la que se revisa (RF-1607, D-35).
   *
   * Nunca la copia de trabajo: un comentario inline pertenece a la versión
   * sobre la que se escribió, y anclarlo a texto sin commitear sería nacer
   * huérfano en cuanto esa copia cambiara.
   */
  private async versionActual(
    appId: string,
  ): Promise<{ id: string; versionNo: number; content: string }> {
    const [fila] = await currentTx()
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        content: documentVersions.content,
      })
      .from(documents)
      .innerJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')));

    if (!fila) {
      throw new ConflictException(
        'There is no committed version to review yet. Commit one and ask again',
      );
    }
    return fila;
  }

  /**
   * Los agentes que pueden intervenir, con su prompt vigente.
   *
   * Sin ninguno no hay revisión que pedir, y se dice en vez de devolver un
   * techo de cero: un botón que promete algo que no va a pasar es peor que un
   * botón que no está (RF-1010).
   */
  private async agentesActivos(appId: string): Promise<AgenteParaRevisar[]> {
    const filas = await currentTx()
      .select({
        id: agents.id,
        handle: agents.handle,
        name: agents.name,
        replyWordLimit: agents.replyWordLimit,
      })
      .from(agents)
      .where(and(eq(agents.appId, appId), eq(agents.active, true), isNull(agents.removedAt)))
      .orderBy(asc(agents.handle));

    if (filas.length === 0) {
      throw new ConflictException('This app has no active agents to review it');
    }

    /*
     * El prompt vigente de cada uno, en serie: comparten la conexión de la
     * transacción y lanzarlas a la vez las encabalga en el mismo cliente. Son
     * cinco como mucho (RF-1507).
     */
    const conPerfil: AgenteParaRevisar[] = [];
    for (const fila of filas) {
      const [revision] = await currentTx()
        .select({ prompt: agentPromptRevisions.prompt })
        .from(agentPromptRevisions)
        .where(eq(agentPromptRevisions.agentId, fila.id))
        .orderBy(desc(agentPromptRevisions.revision))
        .limit(1);

      if (revision) conPerfil.push({ ...fila, prompt: revision.prompt });
    }

    return conPerfil;
  }
}
