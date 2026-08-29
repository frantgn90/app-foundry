import { Global, Injectable, Module } from '@nestjs/common';

import { auditLog } from '@app-foundry/db';

import { currentTx } from '../database/request-context.js';

/** Acciones registrables. Enumerarlas evita cadenas sueltas por el código. */
export const AccionAuditada = {
  SESION_INICIADA: 'sesion.iniciada',
  USUARIO_ALTA: 'usuario.alta',
  WORKSPACE_RENOMBRADO: 'workspace.renombrado',
  INVITACION_CREADA: 'invitacion.creada',
  INVITACION_REVOCADA: 'invitacion.revocada',
  MIEMBRO_EXPULSADO: 'miembro.expulsado',
  MIEMBRO_SALIDA: 'miembro.salida',
} as const;
export type AccionAuditada = (typeof AccionAuditada)[keyof typeof AccionAuditada];

export interface EventoAuditable {
  actorId: string;
  action: AccionAuditada;
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
  async registrar(evento: EventoAuditable): Promise<void> {
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
