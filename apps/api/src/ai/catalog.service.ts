import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray } from 'drizzle-orm';

import type { AiProvider, ModelInfo } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { aiModels, workspaces, workspaceTaskModels } from '@app-foundry/db';

import { currentTx } from '../database/request-context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AI_REGISTRY } from './ai.tokens.js';
import type { AiModelDto } from './ai.dto.js';
import { AiProvidersService } from './providers.service.js';

/**
 * El catálogo de modelos, leído del proveedor y guardado en caché (T-28).
 *
 * Lo que se guarda es lo que el proveedor cuenta de sí mismo: identificador,
 * nombre, ventana de contexto y tope de salida. No hay precios porque ninguno
 * de los dos los publica, y el consumo se mide en tokens (D-37).
 */
@Injectable()
export class AiCatalogService {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly notifications: NotificationsService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Los modelos disponibles para este workspace.
   *
   * Solo de los proveedores que tiene configurados y activos: un catálogo que
   * ofreciera modelos de un proveedor sin credencial invitaría a asignar algo
   * que después no se puede invocar.
   */
  async models(workspaceId: string, userId: string): Promise<AiModelDto[]> {
    /* Solo el dueño asigna modelos, así que solo él necesita la lista (RF-1107). */
    await this.providers.assertOwner(workspaceId, userId);

    const configurados = await this.activeProviders(workspaceId, userId);
    if (configurados.length === 0) return [];

    /*
     * Se sirve **solo** de la caché: pedirle el catálogo al proveedor mientras
     * alguien espera una pantalla ataría el tiempo de respuesta a un tercero
     * (RF-1009). Quien lo mantiene al día es el refresco de fondo, y quien lo
     * estrena es el momento de configurar el proveedor.
     */
    const filas = await currentTx()
      .select()
      .from(aiModels)
      .where(inArray(aiModels.provider, configurados))
      .orderBy(aiModels.provider, aiModels.modelId);

    return filas.map((fila) => ({
      provider: fila.provider,
      id: fila.modelId,
      displayName: fila.displayName,
      contextWindow: fila.contextWindow,
      maxOutputTokens: fila.maxOutputTokens,
      available: fila.available,
    }));
  }

  /**
   * Vuelve a preguntarle al proveedor qué modelos ofrece.
   *
   * Lo que desaparece del catálogo **no se borra**: se marca como no disponible.
   * Borrarlo dejaría sin explicación las asignaciones que apuntaban a él, y lo
   * que hay que hacer con esas es avisar a su dueño (RF-1009).
   */
  async refresh(workspaceId: string, provider: AiProvider): Promise<number> {
    const credential = await this.providers.readCredential(workspaceId, provider);
    const modelos = await this.registry.get(provider).listModels(credential);

    await this.store(provider, modelos);
    await this.warnAboutRetiredModels(workspaceId, provider);
    return modelos.length;
  }

  /**
   * Avisa al dueño si alguna tarea suya apuntaba a un modelo que ya no existe
   * (RF-1009).
   *
   * No se reasigna sola: elegir modelo es una decisión suya, y adivinar el
   * sustituto sería gastar su cuota en algo que no ha pedido. Lo que se hace es
   * que se entere ahora y no cuando alguien tropiece con la función.
   */
  private async warnAboutRetiredModels(workspaceId: string, provider: AiProvider): Promise<void> {
    const huerfanas = await currentTx()
      .select({ task: workspaceTaskModels.task, modelId: workspaceTaskModels.modelId })
      .from(workspaceTaskModels)
      .leftJoin(
        aiModels,
        and(
          eq(aiModels.provider, workspaceTaskModels.provider),
          eq(aiModels.modelId, workspaceTaskModels.modelId),
        ),
      )
      .where(
        and(
          eq(workspaceTaskModels.workspaceId, workspaceId),
          eq(workspaceTaskModels.provider, provider),
          eq(aiModels.available, false),
        ),
      );

    if (huerfanas.length === 0) return;

    const [ws] = await currentTx()
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!ws) return;

    for (const huerfana of huerfanas) {
      await this.notifications.emit({
        type: 'AI_MODEL_UNAVAILABLE',
        /*
         * El actor es el propio dueño porque el refresco corre con su
         * identidad, y nadie se avisa a sí mismo (RF-905). Aquí no hay actor de
         * verdad —lo hizo el proveedor retirando un modelo—, así que se deja sin
         * actor para que el aviso llegue.
         */
        entorno: { actor: '', destinatario: ws.ownerId },
        workspaceId,
        payload: { provider, task: huerfana.task, modelId: huerfana.modelId },
      });
    }
  }

  private async store(provider: AiProvider, modelos: readonly ModelInfo[]): Promise<void> {
    const ahora = new Date();
    const tx = currentTx();

    for (const modelo of modelos) {
      await tx
        .insert(aiModels)
        .values({
          provider,
          modelId: modelo.id,
          displayName: modelo.displayName,
          contextWindow: modelo.contextWindow,
          maxOutputTokens: modelo.maxOutputTokens,
          available: true,
          fetchedAt: ahora,
        })
        .onConflictDoUpdate({
          target: [aiModels.provider, aiModels.modelId],
          set: {
            displayName: modelo.displayName,
            contextWindow: modelo.contextWindow,
            maxOutputTokens: modelo.maxOutputTokens,
            available: true,
            fetchedAt: ahora,
          },
        });
    }

    /*
     * Lo que ya no aparece se marca como no disponible en lugar de borrarse. Un
     * catálogo vacío —el proveedor no devolvió nada— no marca nada: eso no es
     * «ha retirado todos sus modelos», es que algo fue mal.
     */
    const vistos = modelos.map((m) => m.id);
    if (vistos.length === 0) return;

    await tx
      .update(aiModels)
      .set({ available: false })
      .where(and(eq(aiModels.provider, provider), notInArray(aiModels.modelId, vistos)));
  }

  private async activeProviders(workspaceId: string, userId: string): Promise<AiProvider[]> {
    const configurados = await this.providers.list(workspaceId, userId);
    return configurados.filter((p) => p.status === 'ACTIVE').map((p) => p.provider);
  }
}
