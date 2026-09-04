import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import {
  AiTask,
  completeProposals,
  IDEA_BATCH_SCHEMA,
  type IdeaConstraints,
  type IdeaProposal,
  ideasMessages,
  ideasSystemPrompt,
  ProviderError,
  ProviderErrorKind,
  researchMessages,
  researchSystemPrompt,
  roughTokenCount,
  type TokenUsage,
  type WebSource,
} from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { type Database, workspaceMembers } from '@app-foundry/db';

import { conIdentidad } from '../database/con-identidad.js';
import { currentTx } from '../database/request-context.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { AI_REGISTRY } from './ai.tokens.js';
import { AiInvocationService, type InvocationCandidate } from './invocation.service.js';
import { providerMessage } from './provider-http.js';
import { AiTasksService } from './tasks.service.js';
import type { AppSummaryDto } from '../apps/apps.dto.js';
import { AppsService } from '../apps/apps.service.js';
import type { ChooseIdeaDto } from './ai.dto.js';
import { seedVision } from '@app-foundry/core';

/** Cuántas búsquedas puede hacer el modelo al investigar. */
const BUSQUEDAS = 5;

export interface IdeaCommand {
  readonly constraints: IdeaConstraints;
  /** Nombres ya propuestos, para que la siguiente tanda no los repita (RF-1307). */
  readonly exclude?: readonly string[];
}

export type IdeaEvent =
  | {
      readonly type: 'meta';
      readonly provider: string;
      readonly model: string;
      /**
       * Si las propuestas se apoyan en información buscada o solo en lo que el
       * modelo sabe (RF-1304, RF-1305).
       *
       * Viaja siempre, y en el primer evento, porque de esto depende cómo se
       * presenta todo lo demás. Nunca se enseña como fundamentado lo que no lo
       * está.
       */
      readonly grounded: boolean;
      readonly estimatedTokens: number;
    }
  | { readonly type: 'sources'; readonly sources: readonly WebSource[] }
  | { readonly type: 'proposal'; readonly index: number; readonly proposal: IdeaProposal }
  | { readonly type: 'done'; readonly count: number }
  | { readonly type: 'error'; readonly kind: string; readonly message: string };

/**
 * Generación de ideas de app (RF-1301..1307, TRD v2 §12.1).
 *
 * Dos llamadas cuando el modelo sabe buscar —investigar y después dar forma— y
 * una sola cuando no (T-25). Combinar búsqueda de servidor con salida forzada a
 * esquema no está garantizado en ninguno de los dos proveedores, y separarlo,
 * además de ser determinista, deja la fase cara sola y por tanto interrumpible.
 *
 * Las dos llamadas se registran como **dos invocaciones**, porque eso es lo que
 * son: dos consumos de tokens distintos, cada uno con su cupo y su fila. Contar
 * una sería mentir sobre lo que cuesta esta función.
 */
@Injectable()
export class AiIdeasService {
  private readonly logger = new Logger(AiIdeasService.name);

  constructor(
    private readonly invocations: AiInvocationService,
    private readonly tasks: AiTasksService,
    private readonly apps: AppsService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async *generate(
    workspaceId: string,
    command: IdeaCommand,
    userId: string,
    signal: AbortSignal,
  ): AsyncGenerator<IdeaEvent> {
    const plan = await conIdentidad(this.db, userId, async () => {
      await this.assertMember(workspaceId, userId);
      return this.tasks.plan(workspaceId, AiTask.IDEA_GENERATION);
    });

    /*
     * Se pregunta por las capacidades **antes** de invocar porque de ellas
     * depende cuántas llamadas hay y qué papel lleva el modelo: con búsqueda,
     * dos y citando; sin ella, una y diciendo de dónde sale (RF-1305).
     */
    const grounded = this.registry.get(plan.provider).capabilities.webSearch;
    const context = { workspaceId, task: AiTask.IDEA_GENERATION, userId };

    let research: string | undefined;
    let sources: readonly WebSource[] = [];

    try {
      if (grounded) {
        const investigado = await this.research(context, command.constraints, userId, signal);
        research = investigado.text;
        sources = investigado.sources;
      }
    } catch (error) {
      yield this.asError(error);
      return;
    }

    const candidatos: InvocationCandidate[] = [
      {
        label: grounded ? 'con-hallazgos' : 'sin-hallazgos',
        request: {
          system: ideasSystemPrompt(grounded),
          messages: ideasMessages({
            constraints: command.constraints,
            ...(research !== undefined && { research }),
            ...(command.exclude !== undefined && { exclude: command.exclude }),
          }),
        },
      },
    ];

    const empezada = await conIdentidad(this.db, userId, () =>
      this.invocations.begin(context, candidatos),
    );

    yield {
      type: 'meta',
      provider: empezada.plan.provider,
      model: empezada.plan.modelId,
      grounded,
      estimatedTokens: empezada.estimatedTokens,
    };
    if (sources.length > 0) yield { type: 'sources', sources };

    const proveedor = this.registry.get(empezada.plan.provider);
    let crudo = '';
    let enviadas = 0;
    let usage: TokenUsage | null = null;
    let ttftMs: number | undefined;

    try {
      for await (const evento of proveedor.streamObject(
        { ...empezada.request, schema: IDEA_BATCH_SCHEMA, signal },
        empezada.credential,
      )) {
        if (evento.type === 'delta') {
          ttftMs ??= Date.now() - empezada.startedAt;
          crudo += evento.text;

          /*
           * En cuanto una propuesta cierra su llave, ya se puede enseñar: el
           * objeto completo no existe hasta el último carácter, y esperar a él
           * deja la pantalla en blanco toda la generación (RF-1306).
           */
          const completas = completeProposals(crudo);
          for (; enviadas < completas.length; enviadas += 1) {
            yield { type: 'proposal', index: enviadas, proposal: completas[enviadas]! };
          }
        } else if (evento.type === 'usage') {
          usage = evento.usage;
        }
      }

      await this.settle(context, empezada, usage ?? this.estimated(empezada, crudo), userId, {
        outcome: 'COMPLETED',
        ...(ttftMs !== undefined && { ttftMs }),
      });
      yield { type: 'done', count: enviadas };
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : ProviderErrorKind.TRANSIENT;
      const cancelado = signal.aborted || kind === ProviderErrorKind.CANCELLED;

      await this.settle(context, empezada, usage ?? this.estimated(empezada, crudo), userId, {
        outcome: cancelado ? 'CANCELLED' : 'FAILED',
        ...(cancelado ? {} : { errorKind: kind }),
        ...(ttftMs !== undefined && { ttftMs }),
      });

      if (cancelado) return;
      yield { type: 'error', kind, message: providerMessage(kind) };
    }
  }

  /**
   * Convierte una propuesta en una app (RF-1308, RF-1310).
   *
   * Pasa por el mismo alta que crear una a mano: slug, icono, nivel de acceso,
   * precursor y auditoría se deciden en un único sitio. Crear una app con ayuda
   * de la IA no cambia de quién es ni quién la ve, y la manera de garantizarlo es
   * que no exista un segundo camino donde eso se decida (D-9).
   *
   * Lo único que cambia es el documento: nace **sin versión**, con la visión en
   * la copia de trabajo. Lo que ha escrito un modelo llega como borrador y no
   * como algo que alguien haya dado por bueno; darlo por commiteado sería firmar
   * en nombre de quien todavía no lo ha leído (RF-505).
   */
  async choose(
    workspaceId: string,
    proposal: ChooseIdeaDto,
    userId: string,
  ): Promise<AppSummaryDto> {
    const { sources, ...propuesta } = proposal;

    return this.apps.create(
      workspaceId,
      { name: propuesta.name, shortDescription: propuesta.shortDescription },
      userId,
      { vision: seedVision(propuesta, sources ?? []), tags: propuesta.tags },
    );
  }

  /**
   * La primera llamada: buscar y contar lo encontrado, sin proponer nada.
   *
   * Es su propia invocación, con su cupo y su registro. Si falla, no se sigue:
   * dar forma a unas propuestas «fundamentadas» sobre una investigación que no
   * llegó a hacerse sería justo lo que RF-1305 prohíbe.
   */
  private async research(
    context: { workspaceId: string; task: AiTask; userId: string },
    constraints: IdeaConstraints,
    userId: string,
    signal: AbortSignal,
  ): Promise<{ text: string; sources: readonly WebSource[] }> {
    const empezada = await conIdentidad(this.db, userId, () =>
      this.invocations.begin(context, [
        {
          label: 'investigación',
          request: {
            system: researchSystemPrompt(),
            messages: researchMessages(constraints),
            webSearch: { maxUses: BUSQUEDAS },
          },
        },
      ]),
    );

    const proveedor = this.registry.get(empezada.plan.provider);
    let texto = '';
    let fuentes: readonly WebSource[] = [];
    let usage: TokenUsage | null = null;

    try {
      for await (const evento of proveedor.streamText(
        { ...empezada.request, signal },
        empezada.credential,
      )) {
        if (evento.type === 'delta') texto += evento.text;
        else if (evento.type === 'sources') fuentes = evento.sources;
        else if (evento.type === 'usage') usage = evento.usage;
      }
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : ProviderErrorKind.TRANSIENT;
      await this.settle(context, empezada, usage ?? this.estimated(empezada, texto), userId, {
        outcome: signal.aborted ? 'CANCELLED' : 'FAILED',
        ...(signal.aborted ? {} : { errorKind: kind }),
      });
      throw error;
    }

    await this.settle(context, empezada, usage ?? this.estimated(empezada, texto), userId, {
      outcome: 'COMPLETED',
    });
    return { text: texto, sources: fuentes };
  }

  private async assertMember(workspaceId: string, userId: string): Promise<void> {
    const [fila] = await currentTx()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    if (!fila) throw new ForbiddenException('You are not a member of this workspace');
  }

  /** Lo consumido cuando el proveedor no llegó a decirlo: aproximado al alza. */
  private estimated(
    empezada: { estimatedTokens: number; maxOutputTokens: number },
    generado: string,
  ): TokenUsage {
    return {
      inputTokens: Math.max(0, empezada.estimatedTokens - empezada.maxOutputTokens),
      outputTokens: roughTokenCount(generado),
    };
  }

  private async settle(
    context: { workspaceId: string; task: AiTask; userId: string },
    empezada: Parameters<AiInvocationService['finish']>[1],
    usage: TokenUsage,
    userId: string,
    resultado: Parameters<AiInvocationService['finish']>[3],
  ): Promise<void> {
    await conIdentidad(this.db, userId, () =>
      this.invocations.finish(context, empezada, usage, resultado),
    ).catch((error: unknown) => {
      this.logger.error({ err: error }, 'No se pudo liquidar la invocación de ideas');
    });
  }

  private asError(error: unknown): IdeaEvent {
    const kind = error instanceof ProviderError ? error.kind : ProviderErrorKind.TRANSIENT;
    return { type: 'error', kind, message: providerMessage(kind) };
  }
}
