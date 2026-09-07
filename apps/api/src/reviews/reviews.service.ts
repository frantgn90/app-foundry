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
import { agentPromptRevisions, agents, apps, documents, documentVersions } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';
import {
  AiInvocationService,
  AiProviderAccessService,
  AiQuotaService,
} from '@app-foundry/ai-runtime';
import { currentTx, DATABASE, ENV } from '@app-foundry/platform';
import type { Database } from '@app-foundry/db';

import type { ReviewAgentEstimateDto, ReviewEstimateDto } from './reviews.dto.js';

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
