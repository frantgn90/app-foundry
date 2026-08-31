import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import type { AiTask, Credential, TextRequest, TokenUsage } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { aiInvocations, type Database } from '@app-foundry/db';

import { conIdentidad } from '../database/con-identidad.js';
import { currentTx } from '../database/request-context.js';
import { DATABASE } from '../infrastructure/tokens.js';
import { AI_REGISTRY } from './ai.tokens.js';
import { AiProvidersService } from './providers.service.js';
import { AiQuotaService, QuotaExceededError, type Reservation } from './quota.service.js';
import { AiTasksService, type TaskPlan } from './tasks.service.js';

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
  /** El techo de salida, ya acotado por el modelo y por lo que cabe. */
  readonly maxOutputTokens: number;
  readonly estimatedTokens: number;
  readonly reservation: Reservation;
  readonly startedAt: number;
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
    private readonly tasks: AiTasksService,
    private readonly providers: AiProvidersService,
    private readonly quota: AiQuotaService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
    @Inject(DATABASE) private readonly db: Database,
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
    request: Omit<TextRequest, 'model' | 'maxOutputTokens'> & { maxOutputTokens?: number },
    now = Date.now(),
  ): Promise<StartedInvocation> {
    const plan = await this.tasks.plan(context.workspaceId, context.task);
    const credential = await this.providers.readCredential(context.workspaceId, plan.provider);

    const peticion: TextRequest = {
      ...request,
      model: plan.modelId,
      maxOutputTokens: request.maxOutputTokens ?? plan.maxOutputTokens,
    };

    const cuenta = await this.registry.get(plan.provider).countTokens(peticion, credential);

    const maxOutputTokens = this.tasks.assertFits(
      plan,
      cuenta.inputTokens,
      peticion.maxOutputTokens,
    );
    const estimatedTokens = cuenta.inputTokens + maxOutputTokens;

    const cupo = await this.providers.quotaOf(context.workspaceId, plan.provider);

    try {
      const reservation = await this.quota.reserve(
        { workspaceId: context.workspaceId, provider: plan.provider },
        estimatedTokens,
        cupo,
        now,
      );

      return {
        plan,
        credential,
        maxOutputTokens,
        estimatedTokens,
        reservation,
        startedAt: now,
      };
    } catch (error) {
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
      }
      throw error;
    }
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
      errorKind?: string;
      ttftMs?: number;
      now?: number;
    },
  ): Promise<void> {
    const ahora = resultado.now ?? Date.now();

    await this.quota.settle(
      { workspaceId: context.workspaceId, provider: started.plan.provider },
      started.reservation.id,
      usage.inputTokens + usage.outputTokens,
      started.startedAt,
    );

    await this.record(context, started.plan, usage, {
      outcome: resultado.outcome,
      ...(resultado.errorKind !== undefined && { errorKind: resultado.errorKind }),
      ...(resultado.ttftMs !== undefined && { ttftMs: resultado.ttftMs }),
      latencyMs: ahora - started.startedAt,
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
