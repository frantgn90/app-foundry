import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

import {
  type AiTask,
  type Credential,
  explainContextFit,
  fitsInContext,
  ProviderError,
  type ProviderErrorKind,
  type TextRequest,
  type TokenUsage,
} from '@app-foundry/core';
import type { Env } from '@app-foundry/env';
import type { ProviderRegistry } from '@app-foundry/ai';
import { aiInvocations, type Database } from '@app-foundry/db';

import { conIdentidad } from './con-identidad.js';
import { currentTx } from './tx-context.js';
import { AI_METRICS, AI_NOTIFIER, AI_REGISTRY, DATABASE, ENV } from './tokens.js';
import { AiCircuitService } from './circuit.service.js';
import { toProviderHttpException } from './provider-http.js';
import type { AiMetricsPort, AiNotifierPort } from './ports.js';
import { AiProviderAccessService } from './provider-access.service.js';
import {
  AiQuotaService,
  QuotaExceededError,
  RateLimitedError,
  type Reservation,
} from './quota.service.js';
import { AiTaskPlanService, type TaskPlan } from './task-plan.service.js';

/**
 * Una forma de plantear la misma petición.
 *
 * Se pasan varias, de la más completa a la más corta, y se usa la primera que
 * quepa (RF-1409). Es lo que permite mandar el documento entero como contexto
 * cuando cabe y solo el entorno del fragmento cuando no, **sin recortar nunca en
 * silencio**: la que se ha usado viaja de vuelta y se dice en pantalla.
 */
export interface InvocationCandidate {
  /** Cómo se llama esta variante, para poder decir cuál se acabó usando. */
  readonly label: string;
  readonly request: Omit<TextRequest, 'model' | 'maxOutputTokens'> & { maxOutputTokens?: number };
}

interface ChosenRequest {
  readonly peticion: TextRequest;
  readonly variant: string;
  readonly maxOutputTokens: number;
  readonly estimatedTokens: number;
}

/** El techo de una invocación que todavía no se ha hecho (RF-1207, §10). */
export interface InvocationEstimate {
  readonly plan: TaskPlan;
  readonly variant: string;
  readonly maxOutputTokens: number;
  /** Entrada contada más salida al máximo: un techo, no una media. */
  readonly estimatedTokens: number;
}

export interface InvocationContext {
  readonly workspaceId: string;
  readonly appId?: string;
  readonly task: AiTask;
  readonly userId: string;
}

/** Lo que hace falta para invocar, ya resuelto y con el cupo apartado. */
export interface StartedInvocation {
  readonly plan: TaskPlan;
  readonly credential: Credential;
  /** La petición ya cerrada: con modelo, con techo de salida y la que cabe. */
  readonly request: TextRequest;
  /** Cuál de las variantes se ha usado, para poder decirlo (RF-1409). */
  readonly variant: string;
  /** El techo de salida, ya acotado por el modelo y por lo que cabe. */
  readonly maxOutputTokens: number;
  readonly estimatedTokens: number;
  readonly reservation: Reservation;
  readonly startedAt: number;
  /**
   * La traza de esta invocación, abierta en `begin` y cerrada en `finish`.
   *
   * Es hija de la petición que la originó, así que en el visor se ve colgando de
   * ella: cuánto de lo que tardó una petición fue esperar al modelo se lee de un
   * vistazo, sin correlacionar nada a mano (RNF-801).
   */
  readonly span: Span;
}

/**
 * El paso por el que pasa toda invocación (RD-10).
 *
 * Resolver la tarea, contar lo que se va a enviar, comprobar que cabe, apartar
 * el cupo, invocar, liquidar y registrar. No hay ruta que llame a un modelo sin
 * pasar por aquí: la que lo hiciera nacería sin contador y sin techo, y
 * añadírselos después es reescribirla.
 *
 * Se parte en dos actos —`begin` y `finish`— porque en medio está el streaming,
 * que dura y puede cortarse. Lo que garantiza el par es que **siempre** se
 * liquida: también cuando falla, también cuando se cancela.
 */
@Injectable()
export class AiInvocationService {
  private readonly logger = new Logger(AiInvocationService.name);

  constructor(
    private readonly tasks: AiTaskPlanService,
    private readonly providers: AiProviderAccessService,
    private readonly circuit: AiCircuitService,
    private readonly quota: AiQuotaService,
    /* Los dos enganches hacia fuera van por token: son interfaces, no clases. */
    @Inject(AI_NOTIFIER) private readonly notifications: AiNotifierPort,
    @Inject(AI_METRICS) private readonly metrics: AiMetricsPort,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Prepara una invocación: resuelve, cuenta, comprueba y aparta.
   *
   * El techo se calcula como **entrada contada más salida al máximo** (§10). No
   * es una predicción sino un techo, y esa es la gracia: una estimación que se
   * queda corta deja arrancar algo que no cabe en el cupo, y entonces el corte
   * llega a mitad de una revisión ya empezada.
   */
  async begin(
    context: InvocationContext,
    candidatos: readonly InvocationCandidate[],
    now = Date.now(),
  ): Promise<StartedInvocation> {
    /*
     * El ritmo se comprueba lo primero: si alguien está en un bucle, lo barato
     * es pararlo antes de contar tokens y antes de tocar la base de datos.
     */
    try {
      await this.quota.consumeRate(
        context.workspaceId,
        context.userId,
        this.env.AI_MAX_INVOCATIONS_PER_MEMBER_HOUR,
        now,
      );
    } catch (error) {
      if (error instanceof RateLimitedError) {
        /*
         * 429 y con cuántos segundos esperar: aquí no falta cuota, sobra prisa,
         * y volver a intentarlo dentro de un rato **sí** funciona.
         */
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            reason: 'RATE_LIMITED',
            message: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      AiQuotaService.failClosed(error);
    }

    const plan = await this.tasks.plan(context.workspaceId, context.task);

    /*
     * El cortacircuitos, antes de nada más (RNF-704). Si el proveedor lleva un
     * rato sin responder, lo barato y lo honesto es decirlo ya: seguir adelante
     * sería descifrar una credencial, contar tokens y apartar cupo para una
     * llamada que se sabe que va a fallar.
     */
    await this.circuit.assertClosed(plan.provider);

    const credential = await this.providers.readCredential(context.workspaceId, plan.provider);

    /*
     * La traza se abre aquí y se cierra al terminar. Lleva proveedor, modelo,
     * tarea y, después, tokens y desenlace. **Nunca contenido**: ni el prompt,
     * ni el documento, ni la respuesta (RNF-801, T-17).
     */
    const span = trace.getTracer('app-foundry').startSpan('ai.invocation', {
      attributes: {
        'ai.provider': plan.provider,
        'ai.model': plan.modelId,
        'ai.task': context.task,
      },
    });

    /*
     * Se prueban las variantes de la más completa a la más corta y se usa la
     * primera que quepa. Contar cuesta una llamada por variante, y son dos como
     * mucho: sale más barato que enviar algo que el proveedor va a rechazar.
     */
    let elegida;
    try {
      elegida = await this.pickThatFits(plan, credential, candidatos);
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();

      /*
       * Contar tokens ya es hablar con el proveedor, así que aquí se cae por las
       * mismas razones por las que se cae invocando: credencial rechazada,
       * proveedor caído, modelo retirado. Se registra como invocación fallida
       * —con cero tokens, porque no llegó a generarse nada— por el mismo motivo
       * que el corte por cupo: sin la fila, la pregunta «¿por qué dejó de
       * funcionar el martes?» no tiene respuesta, y el panel de errores se
       * queda ciego justo para la clase de fallo más común (RF-1201).
       */
      if (error instanceof ProviderError) {
        await this.failed(context, plan, error.kind);
        /* Con la clave a mano, taparla por su valor exacto y no por su forma. */
        throw toProviderHttpException(error, [credential.apiKey]);
      }
      throw error;
    }
    span.setAttribute('ai.context_variant', elegida.variant);
    const { peticion, variant, maxOutputTokens, estimatedTokens } = elegida;

    const cupo = await this.providers.quotaOf(context.workspaceId, plan.provider);

    try {
      const reservation = await this.quota.reserve(
        { workspaceId: context.workspaceId, provider: plan.provider },
        estimatedTokens,
        cupo,
        now,
      );

      span.setAttribute('ai.estimated_tokens', estimatedTokens);

      return {
        plan,
        credential,
        request: peticion,
        variant,
        maxOutputTokens,
        estimatedTokens,
        reservation,
        startedAt: now,
        span,
      };
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      if (error instanceof QuotaExceededError) {
        /*
         * Un corte por cupo se registra aunque no haya habido llamada: sin él
         * quedaría un hueco en el registro y la pregunta «¿por qué dejó de
         * funcionar el martes?» no tendría respuesta (RF-1201).
         *
         * Y va en **su propia transacción**, no en la de la petición: rechazar
         * hace que esa se deshaga, así que escribir el corte ahí sería
         * escribirlo para nada. Es la única forma de que el registro del corte
         * sobreviva al corte.
         */
        await conIdentidad(this.db, context.userId, () =>
          this.record(
            context,
            plan,
            { inputTokens: 0, outputTokens: 0 },
            {
              outcome: 'QUOTA_BLOCKED',
              latencyMs: 0,
            },
          ),
        ).catch((fallo: unknown) => {
          this.logger.error({ err: fallo }, 'No se pudo registrar el corte por cupo');
        });

        /*
         * Y como métrica, además de como fila: un cupo agotado no es un error
         * del sistema, pero si sube quiere decir que alguien se ha quedado sin
         * IA a mitad de mes y probablemente no entiende por qué (RNF-804).
         */
        this.metrics.invocacionIa({
          provider: plan.provider,
          model: plan.modelId,
          task: context.task,
          outcome: 'QUOTA_BLOCKED',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
        });

        /*
         * 402 y no 429, aunque las dos hablen de límites.
         *
         * Un 429 dice «vuelve en un rato» y hay clientes que reintentan solos al
         * verlo; el cupo mensual agotado no se arregla esperando un rato, sino
         * ampliándolo o esperando al mes que viene. Dárselo como 429 sería
         * invitar a un bucle de reintentos contra una puerta cerrada.
         *
         * El motivo y las cifras van en el cuerpo porque el texto lo escribe la
         * interfaz, en inglés, y lo que no puede inventarse es cuánto se ha
         * gastado (RF-1204: hay que decirlo con claridad en cada punto de uso).
         */
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            reason: 'QUOTA_EXCEEDED',
            message: error.message,
            provider: plan.provider,
            spent: error.state.spent,
            quota: error.state.quota,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      /*
       * Si el contador no se pudo consultar, no se invoca (T-31). Con la cuota
       * de un tercero de por medio, la duda se resuelve a favor del dueño de la
       * clave: seguir adelante sería gastar dinero ajeno sin saber si quedaba.
       */
      AiQuotaService.failClosed(error);
    }
  }

  /** Deja constancia de un intento que ni siquiera llegó a invocar. */
  private async failed(
    context: InvocationContext,
    plan: TaskPlan,
    errorKind: ProviderErrorKind,
  ): Promise<void> {
    /* En su propia transacción: la de la petición se deshace al rechazar. */
    await conIdentidad(this.db, context.userId, () =>
      this.record(
        context,
        plan,
        { inputTokens: 0, outputTokens: 0 },
        { outcome: 'FAILED', errorKind, latencyMs: 0 },
      ),
    ).catch((fallo: unknown) => {
      this.logger.error({ err: fallo }, 'No se pudo registrar el fallo de proveedor');
    });

    this.metrics.invocacionIa({
      provider: plan.provider,
      model: plan.modelId,
      task: context.task,
      outcome: 'FAILED',
      errorKind,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });
  }

  /**
   * La primera variante que cabe, ya contada de verdad (RF-1106, RF-1409).
   *
   * Si no cabe ninguna se rechaza con el motivo y el número de tokens que
   * sobran, en lugar de acortar el texto por nuestra cuenta: un recorte
   * silencioso hace que el modelo responda, que la respuesta parezca razonable y
   * que nadie sepa que opinó sobre la mitad (D-31).
   */
  private async pickThatFits(
    plan: TaskPlan,
    credential: Credential,
    candidatos: readonly InvocationCandidate[],
  ): Promise<ChosenRequest> {
    const proveedor = this.registry.get(plan.provider);
    let ultima: { peticion: TextRequest; inputTokens: number } | null = null;

    for (const candidato of candidatos) {
      const peticion: TextRequest = {
        ...candidato.request,
        model: plan.modelId,
        maxOutputTokens: candidato.request.maxOutputTokens ?? plan.maxOutputTokens,
      };
      /*
       * Contar ya es hablar con el proveedor, así que un fallo aquí también
       * cuenta para el cortacircuitos: si no, una caída durante el recuento
       * nunca llegaría a abrirlo porque no hay liquidación que lo apunte.
       */
      const cuenta = await proveedor
        .countTokens(peticion, credential)
        .catch(async (error: unknown) => {
          if (error instanceof ProviderError) {
            await this.circuit.recordFailure(plan.provider, error.kind);
          }
          throw error;
        });
      ultima = { peticion, inputTokens: cuenta.inputTokens };

      const fit = fitsInContext(cuenta.inputTokens, peticion.maxOutputTokens, plan);
      if (!fit.allowed) continue;

      return {
        peticion,
        variant: candidato.label,
        maxOutputTokens: fit.outputTokens,
        estimatedTokens: cuenta.inputTokens + fit.outputTokens,
      };
    }

    if (!ultima) throw new Error('Se ha pedido invocar sin ninguna petición');

    /*
     * Ninguna cabe: se rechaza con la más corta, que es la que da el número
     * honesto de cuánto hay que acortar.
     */
    const fit = fitsInContext(ultima.inputTokens, ultima.peticion.maxOutputTokens, plan);

    /*
     * Con cuerpo y no solo con mensaje: el texto lo escribe el servidor, que
     * razona en español, y la interfaz está en inglés (RNF-502). Lo que la
     * interfaz no puede inventarse es **cuánto** sobra, así que ese número viaja
     * aparte y allí se redacta la frase.
     */
    throw new BadRequestException({
      statusCode: 400,
      reason: 'CONTEXT_OVERFLOW',
      message: explainContextFit(fit, plan.modelId),
      overflowTokens: fit.overflowTokens,
      modelId: plan.modelId,
    });
  }

  /**
   * Lo que costaría como mucho, sin invocar ni apartar nada (RF-1207, RF-1412).
   *
   * Cuenta de verdad y comprueba que cabe, igual que `begin`, y ahí se para: no
   * abre traza, no reserva cupo y no llama a ningún modelo. Es lo que permite
   * enseñar «como mucho N tokens» **antes** de que alguien se comprometa, que es
   * justo cuando sirve de algo.
   *
   * Cuesta una llamada de recuento al proveedor. Es el precio de que la cifra
   * sea un techo de verdad y no una aproximación de la que luego haya que
   * disculparse.
   */
  async estimate(
    context: InvocationContext,
    candidatos: readonly InvocationCandidate[],
  ): Promise<InvocationEstimate> {
    const plan = await this.tasks.plan(context.workspaceId, context.task);
    const credential = await this.providers.readCredential(context.workspaceId, plan.provider);
    const elegida = await this.pickThatFits(plan, credential, candidatos);

    return {
      plan,
      variant: elegida.variant,
      maxOutputTokens: elegida.maxOutputTokens,
      estimatedTokens: elegida.estimatedTokens,
    };
  }

  /**
   * Cierra la invocación: liquida el cupo y la registra.
   *
   * Se llama **siempre**, con lo que se haya consumido. Lo gastado antes de
   * fallar se gastó igual, y una reserva sin liquidar deja cupo comido hasta
   * que la barra la siguiente.
   */
  async finish(
    context: InvocationContext,
    started: StartedInvocation,
    usage: TokenUsage,
    resultado: {
      outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
      errorKind?: ProviderErrorKind;
      ttftMs?: number;
      now?: number;
    },
  ): Promise<void> {
    const ahora = resultado.now ?? Date.now();

    /*
     * El desenlace alimenta el cortacircuitos. Una cancelación no cuenta ni a
     * favor ni en contra: no dice nada del proveedor, solo de quien se cansó de
     * esperar.
     */
    if (resultado.outcome === 'COMPLETED') {
      await this.circuit.recordSuccess(started.plan.provider);
    } else if (resultado.outcome === 'FAILED' && resultado.errorKind !== undefined) {
      await this.circuit.recordFailure(started.plan.provider, resultado.errorKind);
    }

    await this.quota.settle(
      { workspaceId: context.workspaceId, provider: started.plan.provider },
      started.reservation.id,
      usage.inputTokens + usage.outputTokens,
      started.startedAt,
    );

    const latencyMs = ahora - started.startedAt;

    await this.record(context, started.plan, usage, {
      outcome: resultado.outcome,
      ...(resultado.errorKind !== undefined && { errorKind: resultado.errorKind }),
      ...(resultado.ttftMs !== undefined && { ttftMs: resultado.ttftMs }),
      latencyMs,
    });

    this.metrics.invocacionIa({
      provider: started.plan.provider,
      model: started.plan.modelId,
      task: context.task,
      outcome: resultado.outcome,
      ...(resultado.errorKind !== undefined && { errorKind: resultado.errorKind }),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
      ...(resultado.ttftMs !== undefined && { ttftMs: resultado.ttftMs }),
    });

    started.span.setAttributes({
      'ai.input_tokens': usage.inputTokens,
      'ai.output_tokens': usage.outputTokens,
      'ai.outcome': resultado.outcome,
      ...(resultado.ttftMs !== undefined && { 'ai.ttft_ms': resultado.ttftMs }),
    });
    if (resultado.outcome === 'FAILED') {
      started.span.setStatus({
        code: SpanStatusCode.ERROR,
        message: resultado.errorKind ?? 'failed',
      });
    }
    started.span.end();

    await this.warnIfNearQuota(context, started);
  }

  /**
   * Avisa al dueño al pasar del umbral (RF-1205).
   *
   * Enterarse al agotarse el cupo es enterarse tarde: para entonces la IA ya se
   * ha apagado y alguien se ha quedado a media revisión. El aviso sale una sola
   * vez por mes y proveedor: uno que se repita en cada invocación a partir del
   * 80 % deja de leerse antes de llegar al 90 %.
   */
  private async warnIfNearQuota(
    context: InvocationContext,
    started: StartedInvocation,
  ): Promise<void> {
    const key = { workspaceId: context.workspaceId, provider: started.plan.provider };
    const ajustes = await this.providers.quotaSettingsOf(
      context.workspaceId,
      started.plan.provider,
    );
    if (ajustes.quota === null) return;

    const estado = await this.quota.state(key, ajustes.quota, started.startedAt);
    const porcentaje = Math.round((estado.spent / ajustes.quota) * 100);
    if (porcentaje < ajustes.alertPct) return;

    if (!(await this.quota.claimThresholdAlert(key, started.startedAt))) return;

    await this.notifications.emit({
      type: 'AI_QUOTA_THRESHOLD',
      /* No lo ha hecho nadie: lo ha hecho el uso acumulado del mes. */
      entorno: { actor: '', destinatario: ajustes.ownerId },
      workspaceId: context.workspaceId,
      payload: { provider: started.plan.provider, pct: String(porcentaje) },
    });
  }

  private async record(
    context: InvocationContext,
    plan: TaskPlan,
    usage: TokenUsage,
    extra: {
      outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'QUOTA_BLOCKED';
      errorKind?: string;
      ttftMs?: number;
      latencyMs: number;
    },
  ): Promise<void> {
    await currentTx()
      .insert(aiInvocations)
      .values({
        workspaceId: context.workspaceId,
        ...(context.appId !== undefined && { appId: context.appId }),
        actorUserId: context.userId,
        task: context.task,
        provider: plan.provider,
        modelId: plan.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...extra,
      });
  }
}
