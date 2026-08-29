import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { type Database, workspaceMembers, workspaces } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { currentTx } from '../database/request-context.js';
import { DATABASE, ENV } from '../infrastructure/tokens.js';
import type { PerfilGitHub } from './github.strategy.js';

export interface UsuarioAutenticado {
  id: string;
  handle: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: 'ADMIN' | 'MEMBER';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Da de alta o actualiza al usuario tras un login correcto.
   *
   * Todo ocurre en una transacción: o la persona queda con cuenta, workspace
   * propio e invitaciones aplicadas, o no queda nada a medias. Un usuario sin
   * workspace sería un estado imposible de explicar en la interfaz.
   */
  async provisionar(perfil: PerfilGitHub): Promise<UsuarioAutenticado> {
    return this.db.transaction(async (tx) => {
      const alta = await tx.execute<{ auth_upsert_user: string }>(
        sql`SELECT auth_upsert_user(${perfil.githubId}::bigint, ${perfil.handle}::citext,
                                    ${perfil.email}::citext, ${perfil.displayName}::text,
                                    ${perfil.avatarUrl}::text)`,
      );
      const userId = alta.rows[0]?.auth_upsert_user;
      if (!userId) throw new Error('No se pudo dar de alta al usuario');

      // A partir de aquí ya hay identidad, así que el resto va con las políticas
      // aplicadas como para cualquier otra petición.
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);

      await this.crearWorkspacePersonal(tx, userId, perfil);

      const invitaciones = await tx.execute<{ auth_apply_pending_invitations: number }>(
        sql`SELECT auth_apply_pending_invitations(${userId}::uuid, ${perfil.email}::citext)`,
      );
      const aplicadas = invitaciones.rows[0]?.auth_apply_pending_invitations ?? 0;
      if (aplicadas > 0) {
        this.logger.log(`Aplicadas ${String(aplicadas)} invitaciones pendientes`);
      }

      await this.aplicarAdministradorInicial(tx, perfil.handle);

      const usuario = await tx.execute<Record<string, unknown> & UsuarioAutenticado>(
        sql`SELECT id, handle, email, display_name AS "displayName",
                   avatar_url AS "avatarUrl", platform_role AS "platformRole"
            FROM users WHERE id = ${userId}::uuid`,
      );
      const fila = usuario.rows[0];
      if (!fila) throw new Error('El usuario recién creado no es visible');
      return fila;
    });
  }

  /**
   * Perfil completo del usuario de la petición.
   *
   * Va por la transacción en curso, así que se resuelve con las políticas
   * aplicadas: cada uno puede verse a sí mismo, de modo que esto no abre nada
   * que no estuviera ya abierto.
   */
  async perfil(userId: string): Promise<UsuarioAutenticado> {
    const resultado = await currentTx().execute<Record<string, unknown> & UsuarioAutenticado>(
      sql`SELECT id, handle, email, display_name AS "displayName",
                 avatar_url AS "avatarUrl", platform_role AS "platformRole"
          FROM users WHERE id = ${userId}::uuid`,
    );
    const fila = resultado.rows[0];
    if (!fila) throw new Error('El usuario de la sesión ya no es visible');
    return fila;
  }

  /** Cada cuenta recibe su espacio propio al darse de alta (RF-105). */
  private async crearWorkspacePersonal(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    userId: string,
    perfil: PerfilGitHub,
  ): Promise<void> {
    const existente = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`${workspaces.ownerId} = ${userId} AND ${workspaces.isPersonal}`);
    if (existente.length > 0) return;

    const [creado] = await tx
      .insert(workspaces)
      .values({
        ownerId: userId,
        name: `Workspace de ${perfil.displayName}`,
        // El handle de GitHub es único, así que sirve de slug sin colisiones.
        slug: perfil.handle,
        isPersonal: true,
      })
      .returning({ id: workspaces.id });

    if (creado) {
      await tx.insert(workspaceMembers).values({ workspaceId: creado.id, userId, role: 'OWNER' });
    }
  }

  /**
   * Administrador inicial (RF-111).
   *
   * La función solo asciende si la instancia no tiene todavía ningún
   * administrador activo: es un arranque en frío, no una puerta trasera.
   */
  private async aplicarAdministradorInicial(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    handle: string,
  ): Promise<void> {
    const configurado = this.env.BOOTSTRAP_ADMIN_GITHUB_LOGIN;
    if (!configurado || configurado.toLowerCase() !== handle.toLowerCase()) return;

    const resultado = await tx.execute<{ auth_bootstrap_admin: boolean }>(
      sql`SELECT auth_bootstrap_admin(${handle}::citext)`,
    );
    if (resultado.rows[0]?.auth_bootstrap_admin === true) {
      this.logger.log(`${handle} recibe el rol de administrador de la instancia`);
    }
  }
}
