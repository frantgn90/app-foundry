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

import { AccionAuditada, AuditService } from '../audit/audit.service.js';
import { currentTx } from '../database/request-context.js';
import { ENV } from '../infrastructure/tokens.js';
import type { InvitacionDto, MiembroDto, WorkspaceDto } from './workspaces.dto.js';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly audit: AuditService,
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
  async listar(userId: string): Promise<WorkspaceDto[]> {
    const filas = await currentTx()
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        isPersonal: workspaces.isPersonal,
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

  async renombrar(workspaceId: string, nombre: string, userId: string): Promise<WorkspaceDto> {
    this.exigir(await this.permisoAdministrar(workspaceId, userId));

    const [actualizado] = await currentTx()
      .update(workspaces)
      .set({ name: nombre, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        isPersonal: workspaces.isPersonal,
      });

    if (!actualizado) throw new NotFoundException('El workspace no existe');

    await this.audit.registrar({
      actorId: userId,
      action: AccionAuditada.WORKSPACE_RENOMBRADO,
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      metadata: { nombre },
    });

    return { ...actualizado, role: 'OWNER' };
  }

  async miembros(workspaceId: string): Promise<MiembroDto[]> {
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
  async invitar(workspaceId: string, email: string, userId: string): Promise<InvitacionDto> {
    this.exigir(await this.permisoAdministrar(workspaceId, userId));

    const expira = new Date(Date.now() + this.env.INVITATION_TTL_DAYS * 86_400_000);
    const tx = currentTx();

    const [invitacion] = await tx
      .insert(workspaceInvitations)
      .values({ workspaceId, email, invitedBy: userId, expiresAt: expira })
      .returning();

    if (!invitacion) throw new NotFoundException('No se pudo crear la invitación');

    await tx.execute(sql`SELECT workspace_apply_invitation_if_user_exists(${invitacion.id}::uuid)`);

    await this.audit.registrar({
      actorId: userId,
      action: AccionAuditada.INVITACION_CREADA,
      resourceType: 'invitation',
      resourceId: invitacion.id,
      workspaceId,
      // El email es el objeto de la acción, no contenido de nadie: sin él, la
      // entrada de auditoría no diría nada útil.
      metadata: { email },
    });

    return this.aDto(invitacion.id, email, expira);
  }

  async invitaciones(workspaceId: string, userId: string): Promise<InvitacionDto[]> {
    this.exigir(await this.permisoAdministrar(workspaceId, userId));

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

  async revocarInvitacion(invitationId: string, userId: string): Promise<void> {
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

    await this.audit.registrar({
      actorId: userId,
      action: AccionAuditada.INVITACION_REVOCADA,
      resourceType: 'invitation',
      resourceId: invitationId,
      workspaceId: invitacion.workspaceId,
    });
  }

  async expulsar(workspaceId: string, aQuien: string, userId: string): Promise<void> {
    this.exigir(await this.permisoAdministrar(workspaceId, userId));
    if (aQuien === userId) {
      throw new ForbiddenException('El dueño no puede expulsarse de su propio workspace');
    }

    await currentTx()
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, aQuien)),
      );

    await this.audit.registrar({
      actorId: userId,
      action: AccionAuditada.MIEMBRO_EXPULSADO,
      resourceType: 'user',
      resourceId: aQuien,
      workspaceId,
    });
  }

  /** Abandonar un workspace ajeno (RF-308). El dueño no puede (RF-310). */
  async abandonar(workspaceId: string, userId: string): Promise<void> {
    const rol = await this.rolEn(workspaceId, userId);
    if (rol === null) throw new NotFoundException('No perteneces a este workspace');

    this.exigir(
      canLeaveWorkspace({
        actor: this.actor(userId),
        membership: this.membresia(workspaceId, userId, rol),
      }),
    );

    await currentTx()
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );

    await this.audit.registrar({
      actorId: userId,
      action: AccionAuditada.MIEMBRO_SALIDA,
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

  private membresia(workspaceId: string, userId: string, role: WorkspaceRole): WorkspaceMembership {
    return { workspaceId: asWorkspaceId(workspaceId), userId: asUserId(userId), role };
  }

  private async rolEn(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const [fila] = await currentTx()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return fila?.role ?? null;
  }

  private async permisoAdministrar(workspaceId: string, userId: string): Promise<Decision> {
    const rol = await this.rolEn(workspaceId, userId);
    return canAdministerWorkspace({
      actor: this.actor(userId),
      membership: rol === null ? null : this.membresia(workspaceId, userId, rol),
    });
  }

  /**
   * Traduce una decisión del dominio a una respuesta HTTP.
   *
   * Se responde 404 y no 403 cuando la persona ni siquiera es miembro: decirle
   * "no tienes permiso" ya le confirmaría que ese workspace existe.
   */
  private exigir(decision: Decision): void {
    if (decision.allowed) return;
    if (decision.reason === DenialReason.NOT_A_MEMBER) {
      throw new NotFoundException('El workspace no existe');
    }
    throw new ForbiddenException(decision.reason);
  }

  private aDto(id: string, email: string, expira: Date): InvitacionDto {
    return {
      id,
      email,
      status: 'PENDING',
      expiresAt: expira.toISOString(),
      createdAt: new Date().toISOString(),
    };
  }
}
