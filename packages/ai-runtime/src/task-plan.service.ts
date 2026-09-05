import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { type AiProvider, type AiTask, supportForTask } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { aiModels, workspaceTaskModels } from '@app-foundry/db';

import { currentTx } from '@app-foundry/platform';
import { AI_REGISTRY } from './tokens.js';

/**
 * Con qué modelo se atiende una tarea, aquí y ahora (RF-1101, RF-1102).
 *
 * Se separa de la asignación —que es una pantalla del dueño, con su auditoría y
 * sus DTO— porque son dos cosas distintas: aquella se usa una vez al configurar
 * y esta en **cada invocación**, desde la API y desde el worker. Juntas
 * obligaban a arrastrar la mitad de la capa HTTP a un paquete que no atiende
 * peticiones.
 */
export interface TaskPlan {
  readonly provider: AiProvider;
  readonly modelId: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  /** Capacidades que faltan y solo empobrecen el resultado (RF-1008). */
  readonly degraded: readonly string[];
}

@Injectable()
export class AiTaskPlanService {
  constructor(@Inject(AI_REGISTRY) private readonly registry: ProviderRegistry) {}

  /**
   * Falla con un motivo y no con un genérico.
   *
   * Las tres razones por las que una tarea no se puede atender son distintas y
   * se arreglan de forma distinta: no hay modelo asignado, el asignado
   * desapareció del catálogo de su proveedor, o el proveedor no sabe hacer lo
   * que la tarea exige. Un único «no se puede» dejaría a su dueño adivinando.
   */
  async plan(workspaceId: string, task: AiTask): Promise<TaskPlan> {
    const [fila] = await currentTx()
      .select({
        provider: workspaceTaskModels.provider,
        modelId: workspaceTaskModels.modelId,
        contextWindow: aiModels.contextWindow,
        maxOutputTokens: aiModels.maxOutputTokens,
        available: aiModels.available,
      })
      .from(workspaceTaskModels)
      .leftJoin(
        aiModels,
        and(
          eq(aiModels.provider, workspaceTaskModels.provider),
          eq(aiModels.modelId, workspaceTaskModels.modelId),
        ),
      )
      .where(
        and(eq(workspaceTaskModels.workspaceId, workspaceId), eq(workspaceTaskModels.task, task)),
      );

    if (!fila) {
      throw new BadRequestException(`No hay modelo asignado a ${task} en este workspace`);
    }
    if (!fila.available) {
      throw new BadRequestException(
        `El modelo asignado a ${task} (${fila.modelId}) ya no está en el catálogo de su proveedor`,
      );
    }

    const support = supportForTask(task, this.registry.get(fila.provider).capabilities);
    if (!support.supported) {
      throw new BadRequestException(
        `${fila.provider} no puede atender ${task}: le falta ${support.missing.join(', ')}`,
      );
    }

    return {
      provider: fila.provider,
      modelId: fila.modelId,
      contextWindow: fila.contextWindow ?? 0,
      maxOutputTokens: fila.maxOutputTokens ?? 0,
      degraded: [...support.degraded],
    };
  }
}
