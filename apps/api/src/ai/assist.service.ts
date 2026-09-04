import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';

import {
  AiTask,
  type AssistAction,
  AssistScope,
  assistMessages,
  assistSystemPrompt,
  delayForAttempt,
  hasAttemptsLeft,
  ProviderError,
  ProviderErrorKind,
  ReasoningSplitter,
  retryPolicyFor,
  roughTokenCount,
  surroundingsOf,
  type TokenUsage,
} from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { apps, type Database } from '@app-foundry/db';

import { conIdentidad } from '../database/con-identidad.js';
import type { AssistEstimateDto } from './ai.dto.js';
import { currentTx } from '../database/request-context.js';
import { DocumentsService } from '../documents/documents.service.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { AI_REGISTRY } from './ai.tokens.js';
import {
  AiInvocationService,
  type InvocationCandidate,
  type StartedInvocation,
} from './invocation.service.js';

/** Lo mínimo que se manda a reescribir. Menos que esto no es un texto. */
const MINIMO_CARACTERES = 3;

export interface AssistCommand {
  readonly action: AssistAction;
  readonly scope: AssistScope;
  /** Solo con alcance de selección: posiciones en el fuente de la copia de trabajo. */
  readonly start?: number;
  readonly end?: number;
  /** La revisión que el cliente está mirando (RF-1408). */
  readonly revision: number;
}

/**
 * Lo que sale por el flujo, ya en términos del producto.
 *
 * El error va como evento y no solo como excepción porque cuando llega ya se han
 * enviado las cabeceras: a media respuesta no queda código de estado que dar, y
 * cortar la conexión sin más dejaría al cliente sin saber si terminó o se rompió.
 */
export type AssistEvent =
  | {
      readonly type: 'meta';
      readonly provider: string;
      readonly model: string;
      readonly variant: string;
      /** Verdadero cuando el documento no cabía y se ha enviado solo el entorno. */
      readonly contextTrimmed: boolean;
      readonly maxOutputTokens: number;
      readonly estimatedTokens: number;
      readonly revision: number;
      /** Capacidades que faltan y solo empobrecen el resultado (RF-1008). */
      readonly degraded: readonly string[];
    }
  | { readonly type: 'delta'; readonly text: string }
  /**
   * Lo que el modelo se dice a sí mismo por el camino (`<think>…</think>`).
   *
   * Viaja en su propio evento y **nunca** como parte del texto: el texto se
   * escribe en el documento al aceptar, y la deliberación de un modelo no es
   * algo que nadie quiera dentro de su visión. Se manda igualmente porque
   * entender por qué propuso lo que propuso es a veces más útil que la
   * propuesta.
   */
  | { readonly type: 'reasoning'; readonly text: string }
  /**
   * Si el modelo está **ahora mismo** dentro de su bloque de razonamiento.
   *
   * Se manda solo cuando cambia. Mientras esté abierto no hay respuesta que
   * enseñar, y sin decirlo, un modelo que delibera medio minuto es
   * indistinguible de uno colgado.
   */
  | { readonly type: 'thinking'; readonly active: boolean }
  | { readonly type: 'done'; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly type: 'error'; readonly kind: string; readonly message: string };

/**
 * El asistente de escritura (RF-1401..1411, TRD §12.2).
 *
 * Reescribe lo marcado —o el documento entero— y devuelve el texto por partes.
 * **No aplica nada**: lo que sale de aquí es una propuesta, y quien decide es
 * quien la lee (RF-1403). Aplicarla es un guardado normal de la copia de
 * trabajo, con su comprobación de concurrencia y sin crear versión (RF-1405).
 */
@Injectable()
export class AiAssistService {
  private readonly logger = new Logger(AiAssistService.name);

  constructor(
    private readonly documents: DocumentsService,
    private readonly invocations: AiInvocationService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /**
   * Prepara, invoca y liquida, soltando el texto conforme llega.
   *
   * Es un generador y no una promesa porque el resultado **es** el flujo: quien
   * lo consume puede pintar lo que va llegando y abandonarlo a media respuesta
   * sin esperar al final (RF-1407).
   */
  async *assist(
    appId: string,
    command: AssistCommand,
    userId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AssistEvent> {
    const { workspaceId, candidatos, revision } = await this.prepare(appId, command, userId);

    const context = { workspaceId, appId, task: AiTask.TEXT_ASSIST, userId };
    const empezada = await conIdentidad(this.db, userId, () =>
      this.invocations.begin(context, candidatos),
    );

    yield {
      type: 'meta',
      provider: empezada.plan.provider,
      model: empezada.plan.modelId,
      variant: empezada.variant,
      contextTrimmed: empezada.variant !== 'documento',
      maxOutputTokens: empezada.maxOutputTokens,
      estimatedTokens: empezada.estimatedTokens,
      revision,
      degraded: empezada.plan.degraded,
    };

    yield* this.run(context, empezada, signal, userId);
  }

  /**
   * El techo de tokens de una acción que todavía no se ha pedido (RF-1412).
   *
   * Es la operación interactiva más cara del producto cuando el alcance es el
   * documento entero, y conviene que no sea una sorpresa: se enseña antes de
   * empezar, con las mismas comprobaciones —permiso, revisión, que quepa— que
   * haría la petición de verdad. Así, si va a rechazarse, se rechaza aquí y no
   * después de haber dicho que sí.
   */
  async estimate(
    appId: string,
    command: AssistCommand,
    userId: string,
  ): Promise<AssistEstimateDto> {
    const { workspaceId, candidatos } = await this.prepare(appId, command, userId);

    const techo = await conIdentidad(this.db, userId, () =>
      this.invocations.estimate(
        { workspaceId, appId, task: AiTask.TEXT_ASSIST, userId },
        candidatos,
      ),
    );

    return {
      provider: techo.plan.provider,
      modelId: techo.plan.modelId,
      variant: techo.variant,
      contextTrimmed: techo.variant !== 'documento',
      maxOutputTokens: techo.maxOutputTokens,
      estimatedTokens: techo.estimatedTokens,
    };
  }

  /**
   * Comprueba quién pide qué, y sobre qué texto.
   *
   * Las tres comprobaciones son las que impiden que el asistente se convierta en
   * una vía de escritura paralela: hace falta permiso de **edición** (RF-1406),
   * solo se trabaja sobre la **copia de trabajo** —nunca sobre una versión ya
   * cerrada (RF-1410)— y el cliente tiene que estar mirando la misma revisión
   * que el servidor, o las posiciones que manda apuntan a otro texto (RF-1408).
   */
  private async prepare(
    appId: string,
    command: AssistCommand,
    userId: string,
  ): Promise<{ workspaceId: string; candidatos: InvocationCandidate[]; revision: number }> {
    return conIdentidad(this.db, userId, async () => {
      const documento = await this.documents.get(appId, userId);

      if (!documento.canEdit) {
        throw new ForbiddenException('You can read this app but not edit it');
      }
      if (documento.revision !== command.revision) {
        throw new ConflictException(
          'The working copy changed while you were reading it. Reload before asking again.',
        );
      }

      const [fila] = await currentTx()
        .select({ workspaceId: apps.workspaceId })
        .from(apps)
        .where(eq(apps.id, appId));
      if (!fila) throw new BadRequestException('This app no longer exists');

      return {
        workspaceId: fila.workspaceId,
        revision: documento.revision,
        candidatos: this.candidatesFor(documento.content, command),
      };
    });
  }

  /**
   * Las dos formas de plantear la misma petición, de la más completa a la más
   * corta (RF-1409).
   *
   * Con el documento entero como contexto, el modelo sabe de qué va lo que está
   * reescribiendo; sin él, reescribe una frase a ciegas. Por eso se intenta
   * primero, y solo si no cabe se manda el entorno inmediato —y se dice—.
   *
   * Con alcance de documento no hay dos: el documento **es** el texto, así que
   * mandarlo otra vez como contexto sería pagarlo dos veces.
   */
  private candidatesFor(content: string, command: AssistCommand): InvocationCandidate[] {
    const system = assistSystemPrompt();

    if (command.scope === AssistScope.DOCUMENT) {
      const target = content.trim();
      if (target.length < MINIMO_CARACTERES) {
        throw new BadRequestException('There is nothing written yet to work on');
      }
      return [
        {
          label: 'documento',
          request: { system, messages: assistMessages({ action: command.action, target }) },
        },
      ];
    }

    const { start, end } = command;
    if (start === undefined || end === undefined) {
      throw new BadRequestException('A selection needs a start and an end');
    }
    if (start < 0 || end > content.length || start >= end) {
      throw new BadRequestException('That selection is not inside the document');
    }

    const target = content.slice(start, end);
    if (target.trim().length < MINIMO_CARACTERES) {
      throw new BadRequestException('That selection is too short to work on');
    }

    const entorno = surroundingsOf(content, start, end);

    return [
      {
        label: 'documento',
        request: {
          system,
          messages: assistMessages({ action: command.action, target, context: content }),
        },
      },
      {
        label: 'entorno',
        request: {
          system,
          messages: assistMessages({ action: command.action, target, context: entorno.text }),
        },
      },
    ];
  }

  /**
   * Invoca, reintenta si toca, y liquida pase lo que pase.
   *
   * **Solo se reintenta antes de haber soltado la primera palabra.** Un
   * reintento después de haber enviado texto lo repetiría desde el principio, y
   * quien lo esté leyendo vería la propuesta escribirse dos veces. Es la
   * diferencia entre reintentar una llamada y reintentar una conversación ya
   * empezada (RNF-703).
   */
  private async *run(
    context: { workspaceId: string; appId: string; task: AiTask; userId: string },
    empezada: StartedInvocation,
    signal: AbortSignal,
    userId: string,
  ): AsyncGenerator<AssistEvent> {
    const proveedor = this.registry.get(empezada.plan.provider);
    const peticion = { ...empezada.request, signal };

    /*
     * Lo generado **entero**, razonamiento incluido: es lo que se ha consumido,
     * y lo que hay que registrar si esto se cancela a medias. Lo que va al
     * cliente como texto es otra cosa, y por eso se cuentan aparte.
     */
    let generado = '';
    let enviado = false;
    let usage: TokenUsage | null = null;
    let ttftMs: number | undefined;
    let intento = 0;

    for (;;) {
      intento += 1;
      const separador = new ReasoningSplitter();
      let pensando = false;
      try {
        for await (const evento of proveedor.streamText(peticion, empezada.credential)) {
          if (evento.type === 'delta') {
            ttftMs ??= Date.now() - empezada.startedAt;
            generado += evento.text;

            const parte = separador.push(evento.text);
            if (parte.reasoning !== '') {
              enviado = true;
              yield { type: 'reasoning', text: parte.reasoning };
            }
            if (parte.text !== '') {
              enviado = true;
              yield { type: 'delta', text: parte.text };
            }

            /* Solo cuando cambia: un evento por trozo sería ruido puro. */
            if (separador.unterminated !== pensando) {
              pensando = separador.unterminated;
              yield { type: 'thinking', active: pensando };
            }
          } else if (evento.type === 'usage') {
            usage = evento.usage;
          }
        }

        /* Lo retenido esperando a ver si era una etiqueta: si no lo era, es texto. */
        const ultimo = separador.flush();
        if (ultimo.reasoning !== '') yield { type: 'reasoning', text: ultimo.reasoning };
        if (ultimo.text !== '') yield { type: 'delta', text: ultimo.text };

        const real = usage ?? this.estimatedUsage(empezada, generado);
        await this.settle(
          context,
          empezada,
          real,
          { outcome: 'COMPLETED', ...(ttftMs !== undefined && { ttftMs }) },
          userId,
        );
        yield { type: 'done', inputTokens: real.inputTokens, outputTokens: real.outputTokens };
        return;
      } catch (error) {
        const kind = error instanceof ProviderError ? error.kind : ProviderErrorKind.TRANSIENT;
        const politica = retryPolicyFor(kind);
        if (!enviado && !signal.aborted && hasAttemptsLeft(politica, intento)) {
          await esperar(delayForAttempt(politica, intento + 1));
          continue;
        }

        /*
         * Cancelar no es fallar: lo pidió quien lo estaba leyendo. Se registra
         * como tal y con lo que se llegó a consumir, que se gastó igual.
         */
        const cancelado = signal.aborted || kind === ProviderErrorKind.CANCELLED;
        const real = usage ?? this.estimatedUsage(empezada, generado);
        await this.settle(
          context,
          empezada,
          real,
          {
            outcome: cancelado ? 'CANCELLED' : 'FAILED',
            ...(cancelado ? {} : { errorKind: kind }),
            ...(ttftMs !== undefined && { ttftMs }),
          },
          userId,
        );

        if (cancelado) return;
        yield { type: 'error', kind, message: mensajeDe(kind) };
        return;
      }
    }
  }

  /**
   * Lo consumido cuando el proveedor no llegó a decirlo.
   *
   * Pasa al cancelar a mitad: la entrada se contó de verdad antes de invocar, y
   * de la salida solo tenemos el texto que llegó a llegar. Registrar cero sería
   * mentira y además regalaría cupo ajeno, así que se aproxima al alza (§10).
   */
  private estimatedUsage(empezada: StartedInvocation, generado: string): TokenUsage {
    return {
      inputTokens: Math.max(0, empezada.estimatedTokens - empezada.maxOutputTokens),
      /* Todo lo generado, razonamiento incluido: pensar también se paga. */
      outputTokens: roughTokenCount(generado),
    };
  }

  /** Liquidar y registrar va en su propia transacción: la petición no tiene ninguna. */
  private async settle(
    context: { workspaceId: string; appId: string; task: AiTask; userId: string },
    empezada: StartedInvocation,
    usage: TokenUsage,
    resultado: {
      outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
      errorKind?: ProviderErrorKind;
      ttftMs?: number;
    },
    userId: string,
  ): Promise<void> {
    await conIdentidad(this.db, userId, () =>
      this.invocations.finish(context, empezada, usage, resultado),
    ).catch((error: unknown) => {
      /*
       * Que no se pueda registrar no puede tumbar una respuesta que ya se
       * entregó, pero tampoco puede pasar en silencio: sin este apunte, la
       * reserva queda comiendo cupo hasta que la barra el vencimiento.
       */
      this.logger.error({ err: error }, 'No se pudo liquidar la invocación del asistente');
    });
  }
}

function esperar(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * El motivo, en los términos de quien lo lee.
 *
 * La taxonomía es nuestra y en inglés porque va a la interfaz (RNF-502). Se
 * distingue lo que se arregla esperando de lo que hay que ir a arreglar a los
 * ajustes: son dos acciones distintas y un mensaje genérico no lleva a ninguna.
 */
function mensajeDe(kind: ProviderErrorKind): string {
  switch (kind) {
    case ProviderErrorKind.AUTH:
      return 'The provider rejected the key for this workspace. Its owner needs to check it.';
    case ProviderErrorKind.RATE_LIMIT:
      return 'The provider is asking us to slow down. Try again in a moment.';
    case ProviderErrorKind.CONTEXT_OVERFLOW:
      return 'The text is too long for the model assigned to this task.';
    case ProviderErrorKind.CONTENT_FILTER:
      return 'The provider refused to answer this one.';
    case ProviderErrorKind.MODEL_UNAVAILABLE:
      return 'The model assigned to this task is no longer available.';
    case ProviderErrorKind.SCHEMA:
    case ProviderErrorKind.INVALID_REQUEST:
      return 'Something was wrong with the request. Nothing has been changed.';
    case ProviderErrorKind.CANCELLED:
      return 'Cancelled.';
    case ProviderErrorKind.TRANSIENT:
      return 'The provider did not answer. Try again in a moment.';
  }
}
