import { Global, Injectable, Module } from '@nestjs/common';

import { auditLog } from '@app-foundry/db';

import { currentTx } from '../database/request-context.js';

/** Acciones registrables. Enumerarlas evita cadenas sueltas por el código. */
export const AuditAction = {
  SESSION_STARTED: 'session.started',
  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DEACTIVATED: 'user.deactivated',
  USER_REACTIVATED: 'user.reactivated',
  WORKSPACE_RENAMED: 'workspace.renamed',
  INVITATION_CREATED: 'invitation.created',
  INVITATION_REVOKED: 'invitation.revoked',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_LEFT: 'member.left',
  APP_CREATED: 'app.created',
  APP_UPDATED: 'app.updated',
  APP_ACCESS_LEVEL_CHANGED: 'app.access_level_changed',
  APP_ARCHIVED: 'app.archived',
  APP_UNARCHIVED: 'app.unarchived',
  APP_DELETED: 'app.deleted',
  APP_PRECURSOR_TRANSFERRED: 'app.precursor_transferred',
  APP_PRECURSOR_INHERITED: 'app.precursor_inherited',
  DOCUMENT_VERSION_CREATED: 'document.version_created',
  DOCUMENT_RESTORED: 'document.restored',
  DOCUMENT_RESET: 'document.reset',
  COMMENT_THREAD_CREATED: 'comment.thread_created',
  COMMENT_THREAD_RESOLVED: 'comment.thread_resolved',
  COMMENT_THREAD_REOPENED: 'comment.thread_reopened',
  COMMENT_THREAD_DELETED: 'comment.thread_deleted',
  /* IA (v2). Nunca con la credencial ni con contenido dentro (RF-1703). */
  AI_EGRESS_ACCEPTED: 'ai.egress_accepted',
  AI_PROVIDER_CONFIGURED: 'ai.provider_configured',
  AI_PROVIDER_VERIFIED: 'ai.provider_verified',
  AI_PROVIDER_STATUS_CHANGED: 'ai.provider_status_changed',
  AI_PROVIDER_REMOVED: 'ai.provider_removed',
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
