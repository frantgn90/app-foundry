import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { invitationStatusEnum, workspaceRoleEnum } from './enums.js';
import { citext } from './types.js';
import { users } from './users.js';

/**
 * Espacio de trabajo: contenedor de apps y **frontera de invitación**.
 *
 * En v1 cada usuario tiene exactamente uno, personal, creado al darse de alta.
 * Es una entidad propia y no un sinónimo del usuario para que un workspace de
 * equipo sea el mismo modelo con más roles, y no un rediseño (RD-5).
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: citext('slug').notNull().unique(),
    isPersonal: boolean('is_personal').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('workspaces_owner_id_idx').on(table.ownerId)],
);

/**
 * Quién pertenece a qué workspace y con qué rol.
 *
 * Esta tabla es el corazón del aislamiento: casi todas las políticas de
 * seguridad se resuelven preguntándole a ella.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_id_idx').on(table.userId),
  ],
);

/**
 * Invitación a un workspace, dirigida a un email (RF-304).
 *
 * Se invita a ciegas: el email puede no corresponder a ninguna cuenta todavía,
 * y en ese caso la invitación espera hasta que esa persona se dé de alta
 * (RF-106). Nunca se confirma si existe (RF-312).
 */
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: invitationStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Solo una invitación viva por email y workspace; las revocadas y aceptadas
    // se conservan como histórico y no estorban.
    index('workspace_invitations_email_idx').on(table.email),
    index('workspace_invitations_workspace_idx').on(table.workspaceId),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitationRow = typeof workspaceInvitations.$inferSelect;
