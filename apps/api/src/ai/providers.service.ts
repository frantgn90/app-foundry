import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import {
  type AiProvider,
  type Credential,
  ProviderError,
  ProviderErrorKind,
} from '@app-foundry/core';
import { CredentialCipher } from '@app-foundry/ai';
import type { ProviderRegistry } from '@app-foundry/ai';
import { users, workspaceAiCredentials, workspaceAiProviders, workspaces } from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { currentTx } from '../database/request-context.js';
import { AI_CIPHER, AI_REGISTRY } from './ai.tokens.js';
import type {
  AiEgressConsentDto,
  AiProviderDto,
  AiSettingsDto,
  ConfigureProviderDto,
} from './ai.dto.js';

@Injectable()
export class AiProvidersService {
  constructor(
    private readonly audit: AuditService,
    @Inject(AI_REGISTRY) private readonly registry: ProviderRegistry,
    /* Nulo cuando no hay llavero configurado: la IA es opcional (RD-12). */
    @Inject(AI_CIPHER) private readonly cipher: CredentialCipher | null,
  ) {}

  /**
   * Los proveedores configurados de un workspace (RF-1001).
   *
   * Cualquier miembro los ve —sin saber si hay alguno activo no se puede decidir
   * qué funciones de IA ofrecer (RF-1010)—, pero solo el dueño ve el cupo, la
   * pista de la clave y cuándo se verificó por última vez.
   */
  async list(workspaceId: string, userId: string): Promise<AiProviderDto[]> {
    const esDueño = await this.isOwner(workspaceId, userId);

    const filas = await currentTx()
      .select()
      .from(workspaceAiProviders)
      .where(eq(workspaceAiProviders.workspaceId, workspaceId))
      .orderBy(workspaceAiProviders.provider);

    return filas.map((fila) => ({
      provider: fila.provider,
      status: fila.status,
      capabilities: { ...this.registry.get(fila.provider).capabilities },
      ...(esDueño && {
        credentialHint: fila.credentialHint,
        monthlyTokenQuota: fila.monthlyTokenQuota,
        quotaAlertPct: fila.quotaAlertPct,
        verifiedAt: fila.verifiedAt?.toISOString() ?? null,
      }),
    }));
  }

  /**
   * Guarda o sustituye la credencial de un proveedor (RF-1003, RF-1005).
   *
   * Se verifica **antes** de guardar. Si la clave no sirve, no se almacena nada
   * y se dice por qué: una credencial guardada que no funciona convierte cada
   * función de IA en un fallo distinto y ninguno explica la causa.
   */
  async configure(
    workspaceId: string,
    provider: AiProvider,
    body: ConfigureProviderDto,
    userId: string,
  ): Promise<AiProviderDto> {
    await this.assertOwner(workspaceId, userId);
    await this.enforceEgressConsent(workspaceId);
    const cipher = this.requireCipher();

    const apiKey = body.apiKey.trim();
    await this.verifyAgainstProvider(provider, { apiKey });

    const cifrada = cipher.encrypt(apiKey, { workspaceId, provider });
    const hint = CredentialCipher.hint(apiKey);
    const ahora = new Date();

    await currentTx()
      .insert(workspaceAiProviders)
      .values({
        workspaceId,
        provider,
        status: 'ACTIVE',
        credentialHint: hint,
        createdBy: userId,
        verifiedAt: ahora,
      })
      .onConflictDoUpdate({
        target: [workspaceAiProviders.workspaceId, workspaceAiProviders.provider],
        set: { status: 'ACTIVE', credentialHint: hint, verifiedAt: ahora, updatedAt: ahora },
      });

    await currentTx()
      .insert(workspaceAiCredentials)
      .values({
        workspaceId,
        provider,
        ciphertext: cifrada.ciphertext,
        nonce: cifrada.nonce,
        keyVersion: cifrada.keyVersion,
      })
      .onConflictDoUpdate({
        target: [workspaceAiCredentials.workspaceId, workspaceAiCredentials.provider],
        set: {
          ciphertext: cifrada.ciphertext,
          nonce: cifrada.nonce,
          keyVersion: cifrada.keyVersion,
          updatedAt: ahora,
        },
      });

    /* Ni la clave ni su pista: la auditoría dice qué pasó, no qué decía (RF-1703). */
    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_PROVIDER_CONFIGURED,
      resourceType: 'ai_provider',
      workspaceId,
      metadata: { provider },
    });

    const [dto] = await this.list(workspaceId, userId).then((todos) =>
      todos.filter((p) => p.provider === provider),
    );
    return dto as AiProviderDto;
  }

  /**
   * Vuelve a comprobar una credencial ya guardada (RF-1005, RF-1006).
   *
   * Una clave revocada en el proveedor no avisa: el estado se corrige aquí, y
   * `INVALID` se distingue de `DISABLED` porque lo que hay que hacer para
   * arreglarlo no es lo mismo.
   */
  async verify(workspaceId: string, provider: AiProvider, userId: string): Promise<AiProviderDto> {
    await this.assertOwner(workspaceId, userId);

    const credential = await this.readCredential(workspaceId, provider);
    const ahora = new Date();

    try {
      await this.verifyAgainstProvider(provider, credential);
    } catch (error) {
      if (error instanceof BadRequestException) {
        await currentTx()
          .update(workspaceAiProviders)
          .set({ status: 'INVALID', updatedAt: ahora })
          .where(
            and(
              eq(workspaceAiProviders.workspaceId, workspaceId),
              eq(workspaceAiProviders.provider, provider),
            ),
          );
      }
      throw error;
    }

    await currentTx()
      .update(workspaceAiProviders)
      .set({ status: 'ACTIVE', verifiedAt: ahora, updatedAt: ahora })
      .where(
        and(
          eq(workspaceAiProviders.workspaceId, workspaceId),
          eq(workspaceAiProviders.provider, provider),
        ),
      );

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_PROVIDER_VERIFIED,
      resourceType: 'ai_provider',
      workspaceId,
      metadata: { provider },
    });

    return this.one(workspaceId, provider, userId);
  }

  /** Apagar un proveedor sin borrarlo, y volver a encenderlo (RF-1006). */
  async setStatus(
    workspaceId: string,
    provider: AiProvider,
    status: 'ACTIVE' | 'DISABLED',
    userId: string,
  ): Promise<AiProviderDto> {
    await this.assertOwner(workspaceId, userId);

    const [fila] = await currentTx()
      .update(workspaceAiProviders)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceAiProviders.workspaceId, workspaceId),
          eq(workspaceAiProviders.provider, provider),
        ),
      )
      .returning();

    if (!fila) throw new NotFoundException('Ese proveedor no está configurado');

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_PROVIDER_STATUS_CHANGED,
      resourceType: 'ai_provider',
      workspaceId,
      metadata: { provider, status },
    });

    /*
     * Encender no es fiarse: si la credencial dejó de valer mientras estaba
     * apagado, activarlo sin comprobar deja un proveedor «activo» que falla en
     * la primera invocación.
     *
     * La comprobación va **después** de cambiar el estado, y no antes, porque la
     * función que lee el secreto exige que el proveedor esté activo (AP3). Todo
     * ocurre en la transacción de la petición, así que nadie llega a ver el
     * estado intermedio, y si la credencial ya no sirve la verificación lo deja
     * en `INVALID`.
     */
    if (status === 'ACTIVE') return this.verify(workspaceId, provider, userId);

    return this.one(workspaceId, provider, userId);
  }

  /** Borrar la configuración. La credencial se va con ella, en cascada (RF-1006). */
  async remove(workspaceId: string, provider: AiProvider, userId: string): Promise<void> {
    await this.assertOwner(workspaceId, userId);

    const borradas = await currentTx()
      .delete(workspaceAiProviders)
      .where(
        and(
          eq(workspaceAiProviders.workspaceId, workspaceId),
          eq(workspaceAiProviders.provider, provider),
        ),
      )
      .returning({ provider: workspaceAiProviders.provider });

    if (borradas.length === 0) throw new NotFoundException('Ese proveedor no está configurado');

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_PROVIDER_REMOVED,
      resourceType: 'ai_provider',
      workspaceId,
      metadata: { provider },
    });
  }

  /**
   * La credencial descifrada, para invocar.
   *
   * Pasa por la función acotada de la base de datos, que es la única vía de
   * lectura del secreto y que ya comprueba pertenencia y proveedor activo (AP3).
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

  /** Los ajustes de IA del workspace. Solo su dueño. */
  async settings(workspaceId: string, userId: string): Promise<AiSettingsDto> {
    await this.assertOwner(workspaceId, userId);

    const [fila] = await currentTx()
      .select({ enabled: workspaces.aiEnabled })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    if (!fila) throw new NotFoundException('Ese workspace no existe');

    return { enabled: fila.enabled, consent: await this.egressConsent(workspaceId, userId) };
  }

  /**
   * Apaga o enciende toda la IA del workspace (RF-1012).
   *
   * No borra nada: proveedores, credenciales y agentes se quedan donde estaban.
   * Y lo que de verdad impide invocar no es este servicio sino que, apagado, la
   * función que entrega el secreto deja de entregarlo: así ninguna ruta puede
   * invocar por olvidarse de comprobarlo.
   */
  async setEnabled(workspaceId: string, enabled: boolean, userId: string): Promise<AiSettingsDto> {
    await this.assertOwner(workspaceId, userId);

    await currentTx()
      .update(workspaces)
      .set({ aiEnabled: enabled, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_TOGGLED,
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      metadata: { enabled },
    });

    return this.settings(workspaceId, userId);
  }

  /**
   * Si alguien aceptó ya que el contenido salga a un tercero (RF-1011).
   */
  async egressConsent(workspaceId: string, userId: string): Promise<AiEgressConsentDto> {
    await this.assertOwner(workspaceId, userId);

    const [fila] = await currentTx()
      .select({
        acceptedAt: workspaces.aiEgressAcceptedAt,
        handle: users.handle,
      })
      .from(workspaces)
      .leftJoin(users, eq(users.id, workspaces.aiEgressAcceptedBy))
      .where(eq(workspaces.id, workspaceId));

    if (!fila) throw new NotFoundException('Ese workspace no existe');

    return {
      accepted: fila.acceptedAt !== null,
      acceptedAt: fila.acceptedAt?.toISOString() ?? null,
      acceptedBy: fila.handle ?? null,
    };
  }

  /**
   * Deja constancia de la aceptación.
   *
   * Es idempotente y **no se puede retirar**: lo ya enviado a un tercero no se
   * desenvía, así que un botón de «me arrepiento» prometería algo falso. Lo que
   * sí se puede es apagar la IA del workspace, que es otra cosa (AP7).
   */
  async acceptEgress(workspaceId: string, userId: string): Promise<AiEgressConsentDto> {
    await this.assertOwner(workspaceId, userId);

    const actual = await this.egressConsent(workspaceId, userId);
    if (actual.accepted) return actual;

    await currentTx()
      .update(workspaces)
      .set({ aiEgressAcceptedAt: new Date(), aiEgressAcceptedBy: userId, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AI_EGRESS_ACCEPTED,
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
    });

    return this.egressConsent(workspaceId, userId);
  }

  /**
   * Sin aceptación no se guarda ninguna credencial.
   *
   * Se comprueba aquí y no en la interfaz porque es donde de verdad empieza el
   * envío a terceros: un cliente que se salte el diálogo no puede saltarse esto
   * (RNF-101).
   */
  private async enforceEgressConsent(workspaceId: string): Promise<void> {
    const [fila] = await currentTx()
      .select({ acceptedAt: workspaces.aiEgressAcceptedAt })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    if (!fila?.acceptedAt) {
      throw new ConflictException(
        'Antes de configurar un proveedor hay que aceptar que el contenido de las apps de este workspace se envíe a un tercero',
      );
    }
  }

  private async one(
    workspaceId: string,
    provider: AiProvider,
    userId: string,
  ): Promise<AiProviderDto> {
    const todos = await this.list(workspaceId, userId);
    const dto = todos.find((p) => p.provider === provider);
    if (!dto) throw new NotFoundException('Ese proveedor no está configurado');
    return dto;
  }

  /**
   * Traduce un fallo del proveedor a una respuesta con sentido.
   *
   * Una clave rechazada es culpa de quien la escribió y se dice claro; que el
   * proveedor no conteste no lo es, y decir «clave inválida» en ese caso llevaría
   * a alguien a regenerar una clave que estaba perfectamente.
   */
  private async verifyAgainstProvider(provider: AiProvider, credential: Credential): Promise<void> {
    try {
      await this.registry.get(provider).verify(credential);
    } catch (error) {
      if (error instanceof ProviderError && error.kind === ProviderErrorKind.AUTH) {
        throw new BadRequestException('El proveedor ha rechazado la credencial');
      }
      if (error instanceof ProviderError && error.kind === ProviderErrorKind.TRANSIENT) {
        throw new ServiceUnavailableException(
          'El proveedor no responde ahora mismo; inténtalo de nuevo en un momento',
        );
      }
      throw new BadRequestException(
        error instanceof ProviderError ? error.message : 'No se pudo comprobar la credencial',
      );
    }
  }

  private requireCipher(): CredentialCipher {
    if (!this.cipher) {
      throw new ServiceUnavailableException(
        'Esta instancia no tiene llavero de cifrado configurado (AI_CREDENTIAL_KEYS), así que no puede guardar credenciales',
      );
    }
    return this.cipher;
  }

  private async isOwner(workspaceId: string, userId: string): Promise<boolean> {
    const [fila] = await currentTx()
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    if (!fila) throw new NotFoundException('Ese workspace no existe');
    return fila.ownerId === userId;
  }

  /**
   * La comprobación explícita, además de la política del motor.
   *
   * La RLS ya impediría escribir, pero lo haría devolviendo cero filas, que se
   * lee como «no existe» y no como «no es tuyo». Aquí el rechazo se nombra
   * (RNF-102).
   */
  async assertOwner(workspaceId: string, userId: string): Promise<void> {
    if (!(await this.isOwner(workspaceId, userId))) {
      throw new ForbiddenException('Solo el dueño del workspace configura sus proveedores de IA');
    }
  }
}
