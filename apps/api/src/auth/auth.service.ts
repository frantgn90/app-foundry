import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { auditLog, type Database, workspaceMembers, workspaces } from '@app-foundry/db';
import type { Env } from '@app-foundry/env';

import { currentTx } from '../database/request-context.js';
import { DATABASE, ENV } from '../infrastructure/tokens.js';
import type { GitHubProfile } from './github.strategy.js';

export interface AuthenticatedUser {
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
  async provision(profile: GitHubProfile): Promise<AuthenticatedUser> {
    return this.db.transaction(async (tx) => {
      /*
       * Si la cuenta ya existía se sabe antes de tocarla, porque el alta y el
       * enésimo inicio de sesión son eventos distintos y RF-701 pide los dos.
       * `auth_upsert_user` no distingue uno de otro: hace lo mismo en ambos
       * casos, que es precisamente su virtud.
       */
      const previo = await tx.execute<{ id: string }>(
        sql`SELECT id FROM auth_find_user_by_github_id(${profile.githubId}::bigint)`,
      );
      const esAlta = previo.rows.length === 0;

      const created = await tx.execute<{ auth_upsert_user: string }>(
        sql`SELECT auth_upsert_user(${profile.githubId}::bigint, ${profile.handle}::citext,
                                    ${profile.email}::citext, ${profile.displayName}::text,
                                    ${profile.avatarUrl}::text)`,
      );
      const userId = created.rows[0]?.auth_upsert_user;
      if (!userId) throw new Error('Could not create the user');

      // A partir de aquí ya hay identidad, así que el resto va con las políticas
      // aplicadas como para cualquier otra petición.
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);

      await this.createPersonalWorkspace(tx, userId, profile);

      const applied = await tx.execute<{ auth_apply_pending_invitations: number }>(
        sql`SELECT auth_apply_pending_invitations(${userId}::uuid, ${profile.email}::citext)`,
      );
      const appliedCount = applied.rows[0]?.auth_apply_pending_invitations ?? 0;
      if (appliedCount > 0) {
        this.logger.log(`Aplicadas ${String(appliedCount)} invitaciones pendientes`);
      }

      await this.applyBootstrapAdmin(tx, profile.handle);

      /*
       * Alta y sesión quedan registradas (RF-701). Se escriben aquí, con la
       * identidad ya fijada, porque la política solo deja registrar acciones a
       * nombre propio: fabricar entradas atribuidas a otro es lo único que haría
       * inútil un registro de auditoría.
       *
       * Sin `workspace_id`: son eventos de la plataforma, no de ningún
       * workspace, y es esa ausencia la que decide quién puede consultarlos
       * después (RF-703 frente a RF-704).
       *
       * Nada de lo que se guarda identifica el dispositivo ni la dirección desde
       * la que se entró (RF-706, RNF-112).
       */
      if (esAlta) {
        await tx.insert(auditLog).values({
          actorId: userId,
          action: 'user.created',
          resourceType: 'user',
          resourceId: userId,
          metadata: {},
        });
      }
      await tx.insert(auditLog).values({
        actorId: userId,
        action: 'session.started',
        resourceType: 'session',
        metadata: {},
      });

      const row = await tx.execute<Record<string, unknown> & AuthenticatedUser>(
        sql`SELECT id, handle, email, display_name AS "displayName",
                   avatar_url AS "avatarUrl", platform_role AS "platformRole"
            FROM users WHERE id = ${userId}::uuid`,
      );
      const found = row.rows[0];
      if (!found) throw new Error('The newly created user is not visible');
      return found;
    });
  }

  /**
   * Perfil completo del usuario de la petición.
   *
   * Va por la transacción en curso, así que se resuelve con las políticas
   * aplicadas: cada uno puede verse a sí mismo, de modo que esto no abre nada
   * que no estuviera ya abierto.
   */
  async profile(userId: string): Promise<AuthenticatedUser> {
    const resultado = await currentTx().execute<Record<string, unknown> & AuthenticatedUser>(
      sql`SELECT id, handle, email, display_name AS "displayName",
                 avatar_url AS "avatarUrl", platform_role AS "platformRole"
          FROM users WHERE id = ${userId}::uuid`,
    );
    const fila = resultado.rows[0];
    if (!fila) throw new Error('The session user is no longer visible');
    return fila;
  }

  /** Cada cuenta recibe su espacio propio al darse de alta (RF-105). */
  private async createPersonalWorkspace(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    userId: string,
    profile: GitHubProfile,
  ): Promise<void> {
    const existing = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(sql`${workspaces.ownerId} = ${userId} AND ${workspaces.isPersonal}`);
    if (existing.length > 0) return;

    const [createdWorkspace] = await tx
      .insert(workspaces)
      .values({
        ownerId: userId,
        name: `Workspace de ${profile.displayName}`,
        // El handle de GitHub es único, así que sirve de slug sin colisiones.
        slug: profile.handle,
        isPersonal: true,
      })
      .returning({ id: workspaces.id });

    if (createdWorkspace) {
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: createdWorkspace.id, userId, role: 'OWNER' });
    }
  }

  /**
   * Administrador inicial (RF-111).
   *
   * La función solo asciende si la instancia no tiene todavía ningún
   * administrador activo: es un arranque en frío, no una puerta trasera.
   */
  private async applyBootstrapAdmin(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    handle: string,
  ): Promise<void> {
    const configured = this.env.BOOTSTRAP_ADMIN_GITHUB_LOGIN;
    if (!configured || configured.toLowerCase() !== handle.toLowerCase()) return;

    const result = await tx.execute<{ auth_bootstrap_admin: boolean }>(
      sql`SELECT auth_bootstrap_admin(${handle}::citext)`,
    );
    if (result.rows[0]?.auth_bootstrap_admin === true) {
      this.logger.log(`${handle} recibe el rol de administrador de la instancia`);
    }
  }
}
