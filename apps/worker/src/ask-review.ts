import { Inject, Injectable } from '@nestjs/common';

import { AiTask, ProviderError, ProviderErrorKind, type ReviewOutput } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { AiInvocationService, AI_REGISTRY } from '@app-foundry/ai-runtime';

/**
 * Lo que un agente devuelve al revisar, por el paso común (RD-10).
 *
 * Igual que `AskModel` pero **contra esquema**: la revisión es la única tarea
 * de agente que no admite texto libre, porque cada hallazgo tiene que traer su
 * cita para poder anclarlo y en prosa habría que adivinar dónde acaba la cita y
 * dónde empieza el comentario.
 *
 * Se pide entera y no en streaming: nadie mira la pantalla mientras un agente
 * lee, y media revisión no se puede anclar.
 */
@Injectable()
export class AskReview {
  constructor(
    private readonly invocations: AiInvocationService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  async ask(peticion: {
    workspaceId: string;
    appId: string;
    actorUserId: string;
    agentId: string;
    system: string;
    messages: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
    schema: Record<string, unknown>;
    maxOutputTokens: number;
    /** Para cortar la generación en curso al cancelar (RF-1610). */
    signal?: AbortSignal;
  }): Promise<{ salida: ReviewOutput; provider: string; modelId: string }> {
    const context = {
      workspaceId: peticion.workspaceId,
      appId: peticion.appId,
      task: AiTask.AGENT_REVIEW,
      userId: peticion.actorUserId,
      agentId: peticion.agentId,
    };

    const empezada = await this.invocations.begin(context, [
      {
        label: 'agent-review',
        request: {
          system: peticion.system,
          messages: peticion.messages,
          maxOutputTokens: peticion.maxOutputTokens,
        },
      },
    ]);

    const proveedor = this.registry.get(empezada.plan.provider);
    const inicio = Date.now();
    let crudo = '';
    let ttftMs: number | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let valor: unknown;

    try {
      const flujo = proveedor.streamObject(
        {
          ...empezada.request,
          schema: peticion.schema,
          ...(peticion.signal && { signal: peticion.signal }),
        },
        empezada.credential,
      );

      for await (const evento of flujo) {
        if (evento.type === 'delta') {
          ttftMs ??= Date.now() - inicio;
          crudo += evento.text;
        } else if (evento.type === 'usage') {
          usage = evento.usage;
        } else if (evento.type === 'done') {
          valor = evento.value;
        }
      }

      await this.invocations.finish(context, empezada, usage, {
        outcome: 'COMPLETED',
        ...(ttftMs !== undefined && { ttftMs }),
      });
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : ProviderErrorKind.TRANSIENT;
      await this.invocations.finish(context, empezada, usage, {
        outcome: peticion.signal?.aborted ? 'CANCELLED' : 'FAILED',
        errorKind: kind,
      });
      throw error;
    }

    return {
      salida: interpretar(valor, crudo),
      provider: empezada.plan.provider,
      modelId: empezada.plan.modelId,
    };
  }
}

/**
 * Lo que devolvió el modelo, con la forma que se le pidió.
 *
 * El proveedor entrega el objeto ya montado cuando puede; si no, queda el texto
 * crudo y se interpreta aquí. Lo que no vale se rechaza como `SCHEMA`, que es lo
 * que le da **una** segunda oportunidad y no más (RNF-703): si vuelve a fallar,
 * el problema es el esquema o el modelo, y repetir solo gasta cuota.
 */
function interpretar(valor: unknown, crudo: string): ReviewOutput {
  const objeto = valor ?? intentarLeer(crudo);
  const salida = objeto as Partial<ReviewOutput> | null;

  if (!salida || !Array.isArray(salida.findings) || typeof salida.overall !== 'string') {
    throw new ProviderError(ProviderErrorKind.SCHEMA, 'la revisión no vino con la forma pedida');
  }

  return {
    findings: salida.findings.filter(
      (uno): uno is { quote: string; comment: string } =>
        typeof uno === 'object' &&
        uno !== null &&
        typeof (uno as { quote?: unknown }).quote === 'string' &&
        typeof (uno as { comment?: unknown }).comment === 'string',
    ),
    overall: salida.overall,
  };
}

function intentarLeer(crudo: string): unknown {
  try {
    return JSON.parse(crudo);
  } catch {
    return null;
  }
}
