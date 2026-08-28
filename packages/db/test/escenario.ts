import { sql } from 'drizzle-orm';

import {
  type Database,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '../src/index.js';

/**
 * Escenario compartido por los tests de aislamiento.
 *
 * Ana tiene su workspace y ha invitado a Bruno. Bruno tiene además el suyo
 * propio, donde Ana no está. Carla no comparte nada con nadie: es quien
 * comprueba que un extraño no ve absolutamente nada.
 *
 * Se siembra como superusuario, que siempre ignora RLS, para preparar el
 * escenario sin que las políticas estorben.
 */
export interface Escenario {
  ana: string;
  bruno: string;
  carla: string;
  wsAna: string;
  wsBruno: string;
  invitacionPendiente: string;
}

export async function sembrar(db: Database): Promise<Escenario> {
  const [ana] = await db
    .insert(users)
    .values({ githubId: 2001, handle: 'ana', email: 'ana@example.com', displayName: 'Ana' })
    .returning({ id: users.id });
  const [bruno] = await db
    .insert(users)
    .values({ githubId: 2002, handle: 'bruno', email: 'bruno@example.com', displayName: 'Bruno' })
    .returning({ id: users.id });
  const [carla] = await db
    .insert(users)
    .values({ githubId: 2003, handle: 'carla', email: 'carla@example.com', displayName: 'Carla' })
    .returning({ id: users.id });

  const [wsAna] = await db
    .insert(workspaces)
    .values({ ownerId: ana!.id, name: 'Workspace de Ana', slug: 'ana' })
    .returning({ id: workspaces.id });
  const [wsBruno] = await db
    .insert(workspaces)
    .values({ ownerId: bruno!.id, name: 'Workspace de Bruno', slug: 'bruno' })
    .returning({ id: workspaces.id });

  await db.insert(workspaceMembers).values([
    { workspaceId: wsAna!.id, userId: ana!.id, role: 'OWNER' },
    { workspaceId: wsAna!.id, userId: bruno!.id, role: 'MEMBER' },
    { workspaceId: wsBruno!.id, userId: bruno!.id, role: 'OWNER' },
  ]);

  const [invitacion] = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId: wsAna!.id,
      email: 'daniela@example.com',
      invitedBy: ana!.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning({ id: workspaceInvitations.id });

  return {
    ana: ana!.id,
    bruno: bruno!.id,
    carla: carla!.id,
    wsAna: wsAna!.id,
    wsBruno: wsBruno!.id,
    invitacionPendiente: invitacion!.id,
  };
}

export async function limpiar(db: Database): Promise<void> {
  await db.execute(sql`TRUNCATE users, workspaces, workspace_members,
                       workspace_invitations, sessions RESTART IDENTITY CASCADE`);
}
