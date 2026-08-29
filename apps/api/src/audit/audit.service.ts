import { Global, Injectable, Module } from '@nestjs/common';

import { auditLog } from '@app-foundry/db';

import { currentTx } from '../database/request-context.js';

/** Acciones registrables. Enumerarlas evita cadenas sueltas por el código. */
export const AuditAction = {
  SESSION_STARTED: 'sesion.iniciada',
  USER_CREATED: 'usuario.alta',
  WORKSPACE_RENAMED: 'workspace.renombrado',
  INVITATION_CREATED: 'invitacion.creada',
  INVITATION_REVOKED: 'invitacion.revocada',
  MEMBER_REMOVED: 'miembro.expulsado',
  MEMBER_LEFT: 'miembro.salida',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface AuditEvent {
  actorId: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  /**
   * Registra un evento en la misma transacción que la acción que lo produce.
   *
   * Si la acción se deshace, su rastro también: una auditoría que registra
   * cosas que no llegaron a pasar es peor que no tener ninguna.
   *
   * `metadata` guarda identificadores y valores de enum, nunca contenido ni
   * credenciales (RF-706, RNF-112).
   */
  async record(evento: AuditEvent): Promise<void> {
    await currentTx()
      .insert(auditLog)
      .values({
        actorId: evento.actorId,
        action: evento.action,
        resourceType: evento.resourceType ?? null,
        resourceId: evento.resourceId ?? null,
        workspaceId: evento.workspaceId ?? null,
        metadata: evento.metadata ?? null,
      });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
