import { Inject, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import type { AiProvider, Credential } from '@app-foundry/core';
import type { CredentialCipher } from '@app-foundry/ai';
import { workspaceAiProviders, workspaces } from '@app-foundry/db';

import { currentTx } from './tx-context.js';
import { AI_CIPHER } from './tokens.js';

/**
 * Lo que hace falta leer de un proveedor **para invocarlo**.
 *
 * Tres lecturas y ninguna escritura. Configurar, verificar, apagar y borrar un
 * proveedor es una pantalla del dueño y se queda en la API con su auditoría;
 * esto es lo que ocurre en cada invocación, y lo necesitan por igual la API y
 * el worker.
 */
@Injectable()
export class AiProviderAccessService {
  constructor(
    /* Nulo cuando no hay llavero configurado: la IA es opcional (RD-12). */
    @Inject(AI_CIPHER) private readonly cipher: CredentialCipher | null,
  ) {}

  /**
   * La credencial, descifrada, para una llamada concreta.
   *
   * Pasa por `ai_credential_secret`, que es la única lectura del secreto que
   * tiene el rol de la aplicación: exige miembro del workspace y proveedor
   * activo, y no acepta filtros arbitrarios ni devuelve listados (T-27).
   */
  async readCredential(workspaceId: string, provider: AiProvider): Promise<Credential> {
    const cipher = this.requireCipher();

    const resultado = await currentTx().execute(
      sql`SELECT ciphertext, nonce, key_version FROM ai_credential_secret(${workspaceId}::uuid, ${provider}::ai_provider)`,
    );
    const fila = resultado.rows[0] as
      { ciphertext: Buffer; nonce: Buffer; key_version: number } | undefined;

    if (!fila) throw new NotFoundException('Ese proveedor no está configurado o no está activo');

    return {
      apiKey: cipher.decrypt(
        { ciphertext: fila.ciphertext, nonce: fila.nonce, keyVersion: fila.key_version },
        { workspaceId, provider },
      ),
    };
  }

  /** El cupo mensual de un proveedor, o nulo si no tiene (RF-1204). */
  async quotaOf(workspaceId: string, provider: AiProvider): Promise<number | null> {
    const [fila] = await currentTx()
      .select({ quota: workspaceAiProviders.monthlyTokenQuota })
      .from(workspaceAiProviders)
      .where(
        and(
          eq(workspaceAiProviders.workspaceId, workspaceId),
          eq(workspaceAiProviders.provider, provider),
        ),
      );

    return fila?.quota ?? null;
  }

  /** El cupo, su umbral de aviso y a quién avisar. */
  async quotaSettingsOf(
    workspaceId: string,
    provider: AiProvider,
  ): Promise<{ quota: number | null; alertPct: number; ownerId: string }> {
    const [fila] = await currentTx()
      .select({
        quota: workspaceAiProviders.monthlyTokenQuota,
        alertPct: workspaceAiProviders.quotaAlertPct,
        ownerId: workspaces.ownerId,
      })
      .from(workspaceAiProviders)
      .innerJoin(workspaces, eq(workspaces.id, workspaceAiProviders.workspaceId))
      .where(
        and(
          eq(workspaceAiProviders.workspaceId, workspaceId),
          eq(workspaceAiProviders.provider, provider),
        ),
      );

    return {
      quota: fila?.quota ?? null,
      alertPct: fila?.alertPct ?? 80,
      ownerId: fila?.ownerId ?? '',
    };
  }

  /**
   * Una instancia sin llavero no puede tocar credenciales.
   *
   * Es un 501 y no un 500: no está roto, es que esta instalación no tiene esa
   * pieza montada, y lo que hay que hacer para arreglarlo es configurarla.
   */
  private requireCipher(): CredentialCipher {
    if (!this.cipher) {
      throw new NotImplementedException(
        'Esta instancia no tiene llavero de cifrado configurado (AI_CREDENTIAL_KEYS), así que no puede leer credenciales',
      );
    }
    return this.cipher;
  }
}
