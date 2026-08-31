import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray } from 'drizzle-orm';

import type { AiProvider, ModelInfo } from '@app-foundry/core';
import type { ProviderRegistry } from '@app-foundry/ai';
import { aiModels } from '@app-foundry/db';

import { currentTx } from '../database/request-context.js';
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
    return modelos.length;
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
