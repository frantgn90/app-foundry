import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import {
  type Actor,
  asUserId,
  canManageAccounts,
  type Decision,
  PlatformRole,
  UserStatus,
} from '@app-foundry/core';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { currentTx, trasCommit } from '@app-foundry/ai-runtime';
import type {
  AdminUserDto,
  AuditEntryDto,
  AuditQueryDto,
  InstanceMetricsDto,
  UpdateUserDto,
} from './admin.dto.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async listUsers(actorId: string): Promise<AdminUserDto[]> {
    await this.exigirAdmin(actorId);

    const filas = await currentTx().execute<{
      id: string;
      handle: string;
      display_name: string;
      avatar_url: string | null;
      platform_role: string;
      status: string;
      created_at: string;
      last_login_at: string | null;
      workspace_count: string;
    }>(sql`SELECT * FROM admin_list_users()`);

    return filas.rows.map((f) => ({
      id: f.id,
      handle: f.handle,
      displayName: f.display_name,
      avatarUrl: f.avatar_url,
      platformRole: f.platform_role,
      status: f.status,
      createdAt: aIso(f.created_at),
      lastLoginAt: f.last_login_at === null ? null : aIso(f.last_login_at),
      workspaceCount: Number(f.workspace_count),
      isMe: f.id === actorId,
    }));
  }

  /**
   * Cambia rol o estado de una cuenta (RF-202, RF-203).
   *
   * Las dos garantías que importan viven en la base de datos y no aquí: que la
   * instancia no se quede sin ningún administrador activo, y que desactivar
   * borre las sesiones abiertas en la misma transacción. Comprobarlas en el
   * servicio dejaría una carrera entre dos administradores quitándose el rol a
   * la vez, y ninguno de los dos vería el problema.
   */
  async updateUser(targetId: string, body: UpdateUserDto, actorId: string): Promise<AdminUserDto> {
    await this.exigirAdmin(actorId);

    if (body.platformRole !== undefined) {
      await currentTx().execute(
        sql`SELECT auth_set_platform_role(${targetId}::uuid, ${body.platformRole}::platform_role)`,
      );
      await this.audit.record({
        actorId,
        action: AuditAction.USER_ROLE_CHANGED,
        resourceType: 'user',
        resourceId: targetId,
        metadata: { to: body.platformRole },
      });
    }

    if (body.status !== undefined) {
      const tiradas = await currentTx().execute<{ auth_set_user_status: string }>(
        sql`SELECT auth_set_user_status(${targetId}::uuid, ${body.status}::user_status)`,
      );
      const hashes = tiradas.rows.map((f) => f.auth_set_user_status).filter(Boolean);
      await this.audit.record({
        actorId,
        action:
          body.status === 'DEACTIVATED'
            ? AuditAction.USER_DEACTIVATED
            : AuditAction.USER_REACTIVATED,
        resourceType: 'user',
        resourceId: targetId,
      });

      if (hashes.length > 0) {
        /*
         * Las filas de sesión las borra la función de la base de datos, en esta
         * misma transacción, y devuelve sus hashes. Falta la caché, que vive
         * fuera y no se deshace sola: sin vaciarla, quien acaba de ser
         * desactivado seguiría entrando mientras dure lo cacheado.
         *
         * Se hace tras confirmar, porque echar a alguien por una desactivación
         * que luego se deshace sería peor que tardar un instante.
         */
        trasCommit(() => this.sessions.dropCached(hashes));
      }
    }

    const usuarios = await this.listUsers(actorId);
    const actualizado = usuarios.find((u) => u.id === targetId);
    if (!actualizado) throw new NotFoundException('That account does not exist');
    return actualizado;
  }

  /** Números agregados de la instancia, sin asomarse a ningún workspace (RF-204). */
  async metrics(actorId: string): Promise<InstanceMetricsDto> {
    await this.exigirAdmin(actorId);

    const filas = await currentTx().execute<Record<string, string>>(
      sql`SELECT * FROM admin_instance_metrics()`,
    );
    const f = filas.rows[0];

    return {
      usersTotal: Number(f?.['users_total'] ?? 0),
      usersActive: Number(f?.['users_active'] ?? 0),
      workspacesTotal: Number(f?.['workspaces_total'] ?? 0),
      appsTotal: Number(f?.['apps_total'] ?? 0),
      appsArchived: Number(f?.['apps_archived'] ?? 0),
      versionsTotal: Number(f?.['versions_total'] ?? 0),
      threadsOpen: Number(f?.['threads_open'] ?? 0),
    };
  }

  /**
   * Eventos de plataforma (RF-703).
   *
   * Solo lo que no pertenece a ningún workspace: altas, sesiones, roles. Lo que
   * ocurre dentro de un workspace es asunto de su dueño (RF-704), y ser
   * administrador de la instancia no da acceso a ello (D-6).
   */
  async platformAudit(filtros: AuditQueryDto, actorId: string): Promise<AuditEntryDto[]> {
    await this.exigirAdmin(actorId);

    const filas = await currentTx().execute<{
      id: string;
      actor_id: string | null;
      actor_handle: string | null;
      action: string;
      resource_type: string | null;
      resource_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(sql`SELECT * FROM admin_platform_audit(
             ${filtros.from ?? null}::timestamptz,
             ${filtros.to ?? null}::timestamptz,
             ${filtros.actorId ?? null}::uuid,
             ${200}::integer)`);

    return filas.rows.map((f) => ({
      id: f.id,
      actorId: f.actor_id,
      actorHandle: f.actor_handle,
      action: f.action,
      resourceType: f.resource_type,
      resourceId: f.resource_id,
      metadata: f.metadata ?? {},
      createdAt: aIso(f.created_at),
    }));
  }

  /**
   * Carga la identidad real antes de decidir.
   *
   * El rol se lee de la base de datos en cada petición y no de la sesión: si a
   * alguien le retiran el permiso, deja de tenerlo en la siguiente llamada y no
   * cuando le caduque la sesión.
   */
  private async exigirAdmin(actorId: string): Promise<void> {
    const filas = await currentTx().execute<{ platform_role: string; status: string }>(
      sql`SELECT platform_role, status FROM users WHERE id = ${actorId}::uuid`,
    );
    const fila = filas.rows[0];
    if (!fila) throw new ForbiddenException('This area is for administrators');

    const actor: Actor = {
      id: asUserId(actorId),
      platformRole: fila.platform_role === 'ADMIN' ? PlatformRole.ADMIN : PlatformRole.MEMBER,
      status: fila.status === 'ACTIVE' ? UserStatus.ACTIVE : UserStatus.DEACTIVATED,
    };

    this.exigir(canManageAccounts(actor));
  }

  private exigir(decision: Decision): void {
    // El mismo mensaje tanto si no eres administrador como si tu cuenta está
    // desactivada: distinguirlos diría desde fuera qué hay al otro lado.
    if (!decision.allowed) throw new ForbiddenException('This area is for administrators');
  }
}

/**
 * Normaliza una fecha que viene de SQL crudo.
 *
 * Al ejecutar SQL a pelo, las columnas de una función devuelven cadenas y no
 * `Date`, al revés que las consultas construidas con el ORM. La diferencia no se
 * nota al escribir el código —el tipo declarado dice lo que uno quiera— y
 * revienta al ejecutarlo, así que se acepta cualquiera de las dos formas.
 */
function aIso(valor: string | Date): string {
  return valor instanceof Date ? valor.toISOString() : new Date(valor).toISOString();
}
