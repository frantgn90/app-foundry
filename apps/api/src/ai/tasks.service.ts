import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { AiTask, supportForTask, type AiProvider } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { aiModels, workspaceAiProviders, workspaceTaskModels } from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { currentTx } from '../database/request-context.js';
import { AI_REGISTRY } from './ai.tokens.js';
import type { AiTaskAssignmentDto, AssignTaskModelDto } from './ai.dto.js';
import { AiProvidersService } from './providers.service.js';

const TAREAS = Object.values(AiTask);

/**
 * Qué modelo atiende cada tipo de tarea (RF-1101, RF-1102).
 *
 * El dueño asigna, el resto consume. Es donde se decide en qué se gasta la cuota
 * y lo que hace útil tener dos proveedores a la vez: uno rápido para reescribir
 * un párrafo, uno capaz para razonar (D-34).
 */
@Injectable()
export class AiTasksService {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly audit: AuditService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Las cuatro tareas, asignadas o no.
   *
   * Se devuelven **todas**, también las que no tienen modelo: una tarea sin
   * asignar es una función de IA que no se puede ofrecer, y eso hay que saberlo
   * para no enseñar un botón que no lleva a ninguna parte (RF-1010).
   *
   * La ve cualquier miembro; asignarla, solo el dueño.
   */
  async list(workspaceId: string): Promise<AiTaskAssignmentDto[]> {
    const filas = await currentTx()
      .select({
        task: workspaceTaskModels.task,
        provider: workspaceTaskModels.provider,
        modelId: workspaceTaskModels.modelId,
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
      .where(eq(workspaceTaskModels.workspaceId, workspaceId));

    const porTarea = new Map(filas.map((fila) => [fila.task, fila]));

    return TAREAS.map((task) => {
      const asignada = porTarea.get(task);
      if (!asignada) {
        return {
          task,
          provider: null,
          modelId: null,
          supported: false,
          modelAvailable: false,
          missing: [],
          degraded: [],
        };
      }

      const support = supportForTask(task, this.registry.get(asignada.provider).capabilities);
      /*
       * Un modelo retirado del catálogo deja la tarea sin poder ofrecerse, igual
       * que si al proveedor le faltara una capacidad: lo que cambia es el motivo,
       * y por eso viaja aparte (RF-1009).
       */
      const modelAvailable = asignada.available === true;

      return {
        task,
        provider: asignada.provider,
        modelId: asignada.modelId,
        supported: support.supported && modelAvailable,
        modelAvailable,
        missing: [...support.missing],
        degraded: [...support.degraded],
      };
    });
  }

  /**
   * Asigna un modelo a una tarea.
   *
   * Se comprueban tres cosas antes de guardar, y las tres han fallado alguna vez
   * en productos parecidos: que el proveedor esté configurado y activo aquí, que
   * el modelo exista de verdad en su catálogo, y que el proveedor sepa hacer lo
   * que esa tarea exige. Guardar una asignación imposible convierte un error de
   * configuración en un fallo en tiempo de uso, cuando ya no hay quien lo
   * relacione con esta pantalla.
   */
  async assign(
    workspaceId: string,
    task: AiTask,
    body: AssignTaskModelDto,
    userId: string,
  ): Promise<AiTaskAssignmentDto[]> {
    await this.providers.assertOwner(workspaceId, userId);
    await this.assertUsable(workspaceId, task, body.provider, body.modelId);

    await currentTx()
      .insert(workspaceTaskModels)
      .values({ workspaceId, task, provider: body.provider, modelId: body.modelId })
      .onConflictDoUpdate({
        target: [workspaceTaskModels.workspaceId, workspaceTaskModels.task],
        set: { provider: body.provider, modelId: body.modelId, updatedAt: new Date() },
      });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_TASK_ASSIGNED,
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      metadata: { task, provider: body.provider, modelId: body.modelId },
    });

    return this.list(workspaceId);
  }

  /**
   * Propone una asignación al configurar un proveedor (RF-1103).
   *
   * Solo rellena lo que esté sin asignar: no pisa una decisión que ya tomó
   * alguien. Y solo asigna las tareas que ese proveedor puede atender, así que
   * uno sin salida con esquema no acaba encargado de generar ideas.
   *
   * **El criterio, y su límite.** Ningún proveedor publica una medida de
   * capacidad ni de velocidad, así que se usa la ventana de contexto como
   * aproximación: el modelo más pequeño para asistir a escribir, donde lo que se
   * nota es la latencia y el texto es corto, y el más grande para lo que exige
   * razonar. Es una heurística, no una verdad, y por eso se propone en lugar de
   * imponerse: el dueño la cambia cuando quiera (RF-1102).
   */
  async proposeDefaults(workspaceId: string, provider: AiProvider): Promise<void> {
    const modelos = await currentTx()
      .select({ modelId: aiModels.modelId, contextWindow: aiModels.contextWindow })
      .from(aiModels)
      .where(and(eq(aiModels.provider, provider), eq(aiModels.available, true)))
      .orderBy(aiModels.contextWindow);

    if (modelos.length === 0) return;

    const ligero = modelos[0] as { modelId: string };
    const capaz = modelos[modelos.length - 1] as { modelId: string };

    const yaAsignadas = await currentTx()
      .select({ task: workspaceTaskModels.task })
      .from(workspaceTaskModels)
      .where(eq(workspaceTaskModels.workspaceId, workspaceId));
    const ocupadas = new Set(yaAsignadas.map((fila) => fila.task));

    const capacidades = this.registry.get(provider).capabilities;

    for (const task of TAREAS) {
      if (ocupadas.has(task)) continue;
      if (!supportForTask(task, capacidades).supported) continue;

      const modelId = task === AiTask.TEXT_ASSIST ? ligero.modelId : capaz.modelId;

      await currentTx()
        .insert(workspaceTaskModels)
        .values({ workspaceId, task, provider, modelId })
        .onConflictDoNothing();
    }
  }

  private async assertUsable(
    workspaceId: string,
    task: AiTask,
    provider: AiProvider,
    modelId: string,
  ): Promise<void> {
    const [configurado] = await currentTx()
      .select({ status: workspaceAiProviders.status })
      .from(workspaceAiProviders)
      .where(
        and(
          eq(workspaceAiProviders.workspaceId, workspaceId),
          eq(workspaceAiProviders.provider, provider),
        ),
      );

    if (!configurado || configurado.status !== 'ACTIVE') {
      throw new BadRequestException(`El proveedor ${provider} no está configurado y activo aquí`);
    }

    const [modelo] = await currentTx()
      .select({ available: aiModels.available })
      .from(aiModels)
      .where(and(eq(aiModels.provider, provider), eq(aiModels.modelId, modelId)));

    if (!modelo?.available) {
      throw new BadRequestException(`El modelo ${modelId} no está en el catálogo de ${provider}`);
    }

    const support = supportForTask(task, this.registry.get(provider).capabilities);
    if (!support.supported) {
      throw new BadRequestException(
        `${provider} no puede atender esa tarea: le falta ${support.missing.join(', ')}`,
      );
    }
  }
}
