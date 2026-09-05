import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import {
  AiTask,
  completeProposals,
  GenerationLimit,
  IDEA_BATCH_SCHEMA,
  type IdeaConstraints,
  type IdeaProposal,
  ideasJsonSystemPrompt,
  ideasMessages,
  ideasSystemPrompt,
  type JsonSchema,
  ProviderError,
  ProviderErrorKind,
  redactSecrets,
  researchMessages,
  researchSystemPrompt,
  roughTokenCount,
  type TokenUsage,
  type WebSource,
} from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { type Database, workspaceMembers } from '@app-foundry/db';

import { conIdentidad } from '@app-foundry/platform';
import { currentTx } from '@app-foundry/platform';
import { DATABASE } from '../infrastructure/tokens.js';
import { AI_REGISTRY } from './ai.tokens.js';
import { AiInvocationService, type InvocationCandidate } from '@app-foundry/ai-runtime';
import { providerMessage } from '@app-foundry/ai-runtime';
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
    }
  | { readonly type: 'sources'; readonly sources: readonly WebSource[] }
  /**
   * Algo que se ha tenido que hacer peor, dicho tal cual (RF-1305).
   *
   * No es un error: hay ideas y son utilizables. Pero salieron de un camino más
   * pobre que el que se pidió, y callarlo haría que se leyeran como si no.
   */
  | { readonly type: 'notice'; readonly code: string; readonly message: string }
  | { readonly type: 'proposal'; readonly index: number; readonly proposal: IdeaProposal }
  | { readonly type: 'done'; readonly count: number }
  | {
      readonly type: 'error';
      readonly kind: string;
      readonly message: string;
      /** Lo que dijo el proveedor, redactado: trae el motivo y a veces el enlace. */
      readonly detail: string;
    };

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
    let fundamentado = grounded;
    const avisos: { code: string; message: string }[] = [];

    if (grounded && !signal.aborted) {
      try {
        const investigado = await this.research(context, command.constraints, userId, signal);
        research = investigado.text;
        sources = investigado.sources;

        /*
         * Buscó de verdad solo si el proveedor no dijo lo contrario **y** trajo
         * algo. Una investigación sin una sola fuente no fundamenta nada, y
         * darla por buena sería presentar como respaldado lo que no lo está.
         */
        if (!investigado.buscó || sources.length === 0) {
          fundamentado = false;
          avisos.push({
            code: 'NO_WEB_SEARCH',
            message: investigado.buscó
              ? 'The search came back empty, so these ideas rest on what the model already knew.'
              : 'This model cannot search the web, so it was asked without searching.',
          });
        }
      } catch (error) {
        avisos.push({
          code: 'SEARCH_FAILED',
          message: 'The web search did not go through, so these ideas come from the model alone.',
        });
        /*
         * Buscar es **lo mejor que se puede hacer**, no un requisito.
         *
         * La capacidad se declara por proveedor, pero la realidad es por modelo:
         * Groq ofrece búsqueda web y solo la admiten algunos de sus modelos, y
         * eso no se puede consultar en ninguna parte. Así que se pide, y si la
         * rechaza se generan las ideas igual **diciendo que no están
         * fundamentadas** (RF-1305). Rendirse dejaba sin función a quien tiene
         * un modelo perfectamente capaz de proponer, y el mensaje que le llegaba
         * —«algo iba mal en la petición»— no le decía ni qué ni por qué.
         */
        if (signal.aborted) return;
        fundamentado = false;
        this.logger.warn(
          `${plan.provider} no ha podido buscar con ${plan.modelId}, así que las ideas van sin fundamentar: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    yield {
      type: 'meta',
      provider: plan.provider,
      model: plan.modelId,
      grounded: fundamentado,
    };
    if (sources.length > 0) yield { type: 'sources', sources };
    for (const aviso of avisos) yield { type: 'notice', ...aviso };

    const mensajes = ideasMessages({
      constraints: command.constraints,
      ...(research !== undefined && { research }),
      ...(command.exclude !== undefined && { exclude: command.exclude }),
    });

    /*
     * Primero con el esquema, que es lo que garantiza la forma. Si el modelo no
     * admite ese formato —Groq solo lo ofrece en algunos—, se vuelve a intentar
     * describiendo la forma en el encargo. Es más débil, y por eso es lo
     * segundo; lo que lo hace admisible es que cada propuesta se valida una a
     * una y la que no cuadre se descarta.
     */
    const resultado = yield* this.darForma(
      context,
      {
        label: fundamentado ? 'con-hallazgos' : 'sin-hallazgos',
        request: { system: ideasSystemPrompt(fundamentado), messages: mensajes },
      },
      IDEA_BATCH_SCHEMA,
      userId,
      signal,
    );

    if (resultado !== 'sin-esquema') return;

    this.logger.warn(
      `${plan.provider} no admite salida con esquema en ${plan.modelId}: se describe la forma en el encargo`,
    );

    /*
     * Y se dice, porque cambia lo que vale el resultado: sin la forma
     * garantizada, una propuesta malformada se descarta en silencio y la tanda
     * puede salir más corta de lo pedido. Quien la lea merece saber por qué.
     */
    yield {
      type: 'notice',
      code: 'SHAPE_NOT_GUARANTEED',
      message:
        'This model cannot be held to a fixed answer shape, so it was asked in words. Some ideas may have been dropped if they came back malformed.',
    };

    yield* this.darForma(
      context,
      {
        label: 'forma-descrita',
        request: { system: ideasJsonSystemPrompt(fundamentado), messages: mensajes },
      },
      undefined,
      userId,
      signal,
    );
  }

  /**
   * Pide las propuestas y las va soltando conforme se cierran.
   *
   * Con esquema o sin él: la diferencia es quién garantiza la forma, el proveedor
   * o el encargo. Lo demás —cupo, registro, troceado, validación— es idéntico,
   * y por eso es un solo sitio.
   *
   * Devuelve `sin-esquema` cuando el proveedor rechaza el formato con esquema,
   * que es lo único que quien llama necesita distinguir para volver a intentarlo
   * de otra manera.
   */
  private async *darForma(
    context: { workspaceId: string; task: AiTask; userId: string },
    candidato: InvocationCandidate,
    schema: JsonSchema | undefined,
    userId: string,
    signal: AbortSignal,
  ): AsyncGenerator<IdeaEvent, 'ok' | 'sin-esquema' | 'fallo'> {
    const empezada = await conIdentidad(this.db, userId, () =>
      this.invocations.begin(context, [candidato]),
    );

    const proveedor = this.registry.get(empezada.plan.provider);
    let crudo = '';
    let enviadas = 0;
    let usage: TokenUsage | null = null;
    let ttftMs: number | undefined;

    try {
      const flujo = schema
        ? proveedor.streamObject({ ...empezada.request, schema, signal }, empezada.credential)
        : proveedor.streamText({ ...empezada.request, signal }, empezada.credential);

      for await (const evento of flujo) {
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
      return 'ok';
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : ProviderErrorKind.TRANSIENT;
      const cancelado = signal.aborted || kind === ProviderErrorKind.CANCELLED;

      /*
       * El motivo del proveedor, entero, en el registro del servidor.
       *
       * Al cliente le llega la taxonomía —«algo iba mal en la petición»—, que es
       * lo que se puede enseñar sin arriesgarse a filtrar la clave (RNF-602).
       * Pero eso no basta para arreglar nada: cuál de las dos llamadas falló y
       * qué dijo exactamente el proveedor solo se sabe si consta aquí.
       */
      if (!cancelado) {
        this.logger.warn(
          `${empezada.plan.provider} ha rechazado dar forma a las ideas con ${empezada.plan.modelId} (${kind}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      await this.settle(context, empezada, usage ?? this.estimated(empezada, crudo), userId, {
        outcome: cancelado ? 'CANCELLED' : 'FAILED',
        ...(cancelado ? {} : { errorKind: kind }),
        ...(ttftMs !== undefined && { ttftMs }),
      });

      if (cancelado) return 'fallo';

      /*
       * Rechazar el formato antes de escribir nada es distinto de fallar a
       * mitad: lo primero se puede volver a intentar de otra forma, lo segundo
       * dejaría la lista con propuestas repetidas.
       */
      if (schema && kind === ProviderErrorKind.SCHEMA && enviadas === 0) return 'sin-esquema';

      yield {
        type: 'error',
        kind,
        message: providerMessage(kind),
        detail: redactSecrets(error instanceof Error ? error.message : String(error), [
          empezada.credential.apiKey,
        ]),
      };
      return 'fallo';
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
  ): Promise<{ text: string; sources: readonly WebSource[]; buscó: boolean }> {
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
    let buscó = true;

    try {
      for await (const evento of proveedor.streamText(
        { ...empezada.request, signal },
        empezada.credential,
      )) {
        if (evento.type === 'delta') texto += evento.text;
        else if (evento.type === 'sources') fuentes = evento.sources;
        else if (evento.type === 'usage') usage = evento.usage;
        /* El proveedor avisa de que no ha podido buscar: la llamada sale bien igual. */
        else if (evento.type === 'limit' && evento.limit === GenerationLimit.NO_WEB_SEARCH) {
          buscó = false;
        }
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
    return { text: texto, sources: fuentes, buscó };
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
}
