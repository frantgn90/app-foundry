import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  type Actor,
  asUserId,
  asWorkspaceId,
  canAdministerWorkspace,
  canLeaveWorkspace,
  type Decision,
  DenialReason,
  PlatformRole,
  UserStatus,
  type WorkspaceMembership,
  type WorkspaceRole,
} from '@app-foundry/core';
import { users, workspaceInvitations, workspaceMembers, workspaces } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { currentTx } from '@app-foundry/platform';
import { ENV } from '../infrastructure/tokens.js';
import type {
  InvitationDto,
  MemberDto,
  UpdateWorkspaceDto,
  WorkspaceDto,
  WorkspaceAuditEntryDto,
} from './workspaces.dto.js';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Workspaces visibles para quien pregunta: el suyo y aquellos a los que le
   * invitaron (RF-302).
   *
   * No hace falta filtrar por usuario: la Row-Level Security ya solo devuelve
   * lo que esta persona puede ver. Añadir un `where` aquí sería duplicar la
   * regla y arriesgarse a que las dos copias diverjan.
   */
  async list(userId: string): Promise<WorkspaceDto[]> {
    const filas = await currentTx()
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        isPersonal: workspaces.isPersonal,
        iconEmoji: workspaces.iconEmoji,
        iconColor: workspaces.iconColor,
        background: workspaces.background,
        role: workspaceMembers.role,
      })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
      )
      .orderBy(desc(workspaces.isPersonal), workspaces.name);

    return filas.map((f) => ({ ...f, role: f.role }));
  }

  /** Nombre y aspecto del workspace (RF-303). Solo su dueño. */
  async update(
    workspaceId: string,
    changes: UpdateWorkspaceDto,
    userId: string,
  ): Promise<WorkspaceDto> {
    this.enforce(await this.adminDecision(workspaceId, userId));

    const [updated] = await currentTx()
      .update(workspaces)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        isPersonal: workspaces.isPersonal,
        iconEmoji: workspaces.iconEmoji,
        iconColor: workspaces.iconColor,
        background: workspaces.background,
      });

    if (!updated) throw new NotFoundException('The workspace does not exist');

    await this.audit.record({
      actorId: userId,
      action: AuditAction.WORKSPACE_RENAMED,
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      // Qué campos se tocaron, no sus valores: el nombre sí es identificativo
      // y se guarda, el resto es aspecto y no aporta nada al registro.
      metadata: { fields: Object.keys(changes), ...(changes.name ? { name: changes.name } : {}) },
    });

    return { ...updated, role: 'OWNER' };
  }

  async members(workspaceId: string): Promise<MemberDto[]> {
    return currentTx()
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(desc(workspaceMembers.role), users.handle);
  }

  /**
   * Invita por email (RF-304).
   *
   * El camino es idéntico exista o no esa cuenta: siempre se crea la invitación
   * y siempre se intenta aplicar. Quien invita recibe la misma respuesta en
   * ambos casos, así que invitar no sirve para averiguar quién usa la
   * plataforma (RF-312).
   */
  async invite(workspaceId: string, email: string, userId: string): Promise<InvitationDto> {
    this.enforce(await this.adminDecision(workspaceId, userId));

    const expira = new Date(Date.now() + this.env.INVITATION_TTL_DAYS * 86_400_000);
    const tx = currentTx();

    const [invitacion] = await tx
      .insert(workspaceInvitations)
      .values({ workspaceId, email, invitedBy: userId, expiresAt: expira })
      .returning();

    if (!invitacion) throw new NotFoundException('No se pudo crear la invitación');

    await tx.execute(sql`SELECT workspace_apply_invitation_if_user_exists(${invitacion.id}::uuid)`);

    /*
     * Si esa dirección tenía cuenta, la invitación ya la ha metido en el
     * workspace y por tanto es visible: se le avisa. Si no la tenía, aquí no hay
     * nadie y no se avisa a nadie.
     *
     * Quien invita no ve la diferencia —la respuesta es la misma en ambos
     * casos—, que es justo lo que impide usar la invitación para averiguar quién
     * tiene cuenta (RF-312).
     */
    const [invitado] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, email)));

    if (invitado) {
      const [ws] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      const [quien] = await tx
        .select({ handle: users.handle })
        .from(users)
        .where(eq(users.id, userId));

      await this.notifications.emit({
        type: 'WORKSPACE_INVITED',
        entorno: { actor: userId, destinatario: invitado.id },
        workspaceId,
        payload: { actorHandle: quien?.handle ?? '', workspaceName: ws?.name ?? '' },
      });
    }

    await this.audit.record({
      actorId: userId,
      action: AuditAction.INVITATION_CREATED,
      resourceType: 'invitation',
      resourceId: invitacion.id,
      workspaceId,
      // El email es el objeto de la acción, no contenido de nadie: sin él, la
      // entrada de auditoría no diría nada útil.
      metadata: { email },
    });

    return this.toDto(invitacion.id, email, expira);
  }

  async invitations(workspaceId: string, userId: string): Promise<InvitationDto[]> {
    this.enforce(await this.adminDecision(workspaceId, userId));

    const filas = await currentTx()
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.workspaceId, workspaceId))
      .orderBy(desc(workspaceInvitations.createdAt));

    return filas.map((f) => ({
      id: f.id,
      email: f.email,
      status: f.status,
      expiresAt: f.expiresAt.toISOString(),
      createdAt: f.createdAt.toISOString(),
    }));
  }

  async revokeInvitation(invitationId: string, userId: string): Promise<void> {
    const tx = currentTx();
    // La RLS ya impide ver invitaciones de workspaces ajenos, así que si no
    // aparece es que no existe o no es asunto de quien pregunta.
    const [invitacion] = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.id, invitationId));
    if (!invitacion) throw new NotFoundException('La invitación no existe');

    await tx
      .update(workspaceInvitations)
      .set({ status: 'REVOKED' })
      .where(eq(workspaceInvitations.id, invitationId));

    await this.audit.record({
      actorId: userId,
      action: AuditAction.INVITATION_REVOKED,
      resourceType: 'invitation',
      resourceId: invitationId,
      workspaceId: invitacion.workspaceId,
    });
  }

  /**
   * Traspasa al dueño las apps de quien deja el workspace (RF-413).
   *
   * Se hace **antes** de borrar la membresía, y no es un detalle: el aviso al
   * dueño lo escribe quien está ejecutando esto, y las políticas exigen que
   * quien escribe un aviso pertenezca al workspace. Hecho después, quien se
   * marcha ya no sería miembro y el aviso sería rechazado.
   */
  /**
   * Lo que ha pasado dentro del workspace (RF-704).
   *
   * La comprobación de que quien pregunta es el dueño la hace la función de la
   * base de datos, no este método: `audit_log` no es legible desde la
   * aplicación, y abrirla con una política la dejaría al alcance de cualquier
   * consulta descuidada. Por eso no recibe el usuario: la identidad ya está
   * fijada en la transacción, y pasarla aquí haría creer que se usa.
   */
  async actividad(workspaceId: string): Promise<WorkspaceAuditEntryDto[]> {
    const filas = await currentTx().execute<{
      id: string;
      actor_handle: string | null;
      action: string;
      resource_type: string | null;
      resource_id: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>(sql`SELECT * FROM workspace_audit(${workspaceId}::uuid, NULL, NULL, ${200}::integer)`);

    return filas.rows.map((f) => ({
      id: f.id,
      actorHandle: f.actor_handle,
      action: f.action,
      resourceType: f.resource_type,
      resourceId: f.resource_id,
      metadata: f.metadata ?? {},
      createdAt: new Date(f.created_at).toISOString(),
    }));
  }

  private async heredarApps(workspaceId: string, aQuien: string, actor: string): Promise<void> {
    const heredadas = await currentTx().execute<{
      app_id: string;
      app_name: string;
      new_precursor: string;
    }>(sql`SELECT * FROM workspace_inherit_apps(${workspaceId}::uuid, ${aQuien}::uuid)`);

    if (heredadas.rows.length === 0) return;
    const dueno = heredadas.rows[0]!.new_precursor;

    for (const fila of heredadas.rows) {
      await this.audit.record({
        actorId: actor,
        action: AuditAction.APP_PRECURSOR_INHERITED,
        resourceType: 'app',
        resourceId: fila.app_id,
        workspaceId,
        // Quién lo deja y quién lo recibe; nunca nada del contenido (RF-706).
        metadata: { from: aQuien, to: dueno },
      });
    }

    const [ws] = await currentTx()
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    const [quien] = await currentTx()
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.id, aQuien));

    await this.notifications.emit({
      type: 'APPS_INHERITED',
      entorno: { actor, destinatario: dueno },
      workspaceId,
      payload: {
        actorHandle: quien?.handle ?? '',
        workspaceName: ws?.name ?? '',
        count: heredadas.rows.length,
        // Los nombres hacen el aviso legible sin tener que ir a mirar.
        appNames: heredadas.rows.map((f) => f.app_name).slice(0, 5),
      },
    });
  }

  async removeMember(workspaceId: string, aQuien: string, userId: string): Promise<void> {
    this.enforce(await this.adminDecision(workspaceId, userId));
    if (aQuien === userId) {
      throw new ForbiddenException('El dueño no puede expulsarse de su propio workspace');
    }

    await this.heredarApps(workspaceId, aQuien, userId);

    await currentTx()
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, aQuien)),
      );

    await this.audit.record({
      actorId: userId,
      action: AuditAction.MEMBER_REMOVED,
      resourceType: 'user',
      resourceId: aQuien,
      workspaceId,
    });
  }

  /** Abandonar un workspace ajeno (RF-308). El dueño no puede (RF-310). */
  async leave(workspaceId: string, userId: string): Promise<void> {
    const rol = await this.roleIn(workspaceId, userId);
    if (rol === null) throw new NotFoundException('No perteneces a este workspace');

    this.enforce(
      canLeaveWorkspace({
        actor: this.actor(userId),
        membership: this.membership(workspaceId, userId, rol),
      }),
    );

    await this.heredarApps(workspaceId, userId, userId);

    await currentTx()
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );

    await this.audit.record({
      actorId: userId,
      action: AuditAction.MEMBER_LEFT,
      resourceType: 'user',
      resourceId: userId,
      workspaceId,
    });
  }

  /**
   * Actor para las reglas del dominio.
   *
   * El rol de plataforma es MEMBER y el estado ACTIVE porque estas reglas no
   * dependen de ninguno de los dos: el administrador de plataforma no tiene
   * acceso al contenido de workspaces ajenos (D-6), y una cuenta desactivada
   * nunca llega hasta aquí, porque la validación de sesión ya la rechaza.
   */
  private actor(userId: string): Actor {
    return {
      id: asUserId(userId),
      platformRole: PlatformRole.MEMBER,
      status: UserStatus.ACTIVE,
    };
  }

  private membership(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): WorkspaceMembership {
    return { workspaceId: asWorkspaceId(workspaceId), userId: asUserId(userId), role };
  }

  private async roleIn(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const [fila] = await currentTx()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return fila?.role ?? null;
  }

  private async adminDecision(workspaceId: string, userId: string): Promise<Decision> {
    const rol = await this.roleIn(workspaceId, userId);
    return canAdministerWorkspace({
      actor: this.actor(userId),
      membership: rol === null ? null : this.membership(workspaceId, userId, rol),
    });
  }

  /**
   * Traduce una decisión del dominio a una respuesta HTTP.
   *
   * Se responde 404 y no 403 cuando la persona ni siquiera es miembro: decirle
   * "no tienes permiso" ya le confirmaría que ese workspace existe.
   */
  private enforce(decision: Decision): void {
    if (decision.allowed) return;
    if (decision.reason === DenialReason.NOT_A_MEMBER) {
      throw new NotFoundException('El workspace no existe');
    }
    throw new ForbiddenException(decision.reason);
  }

  private toDto(id: string, email: string, expira: Date): InvitationDto {
    return {
      id,
      email,
      status: 'PENDING',
      expiresAt: expira.toISOString(),
      createdAt: new Date().toISOString(),
    };
  }
}
