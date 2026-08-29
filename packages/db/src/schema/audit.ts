import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Registro de auditoría (RF-701..706).
 *
 * Dice **qué pasó**, no **qué decía**: `metadata` guarda identificadores y
 * valores de enum —qué nivel de acceso se cambió, a qué rol se promovió—, nunca
 * contenido de documentos ni de comentarios, ni tokens, ni direcciones IP
 * (RF-706, RNF-112).
 *
 * Es de solo escritura desde la aplicación: al rol `app_user` no se le concede
 * UPDATE ni DELETE, así que la garantía es de permisos de Postgres y no de
 * disciplina (RF-705).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    /** Permite que el dueño de un workspace consulte su actividad (RF-704). */
    workspaceId: uuid('workspace_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_workspace_idx').on(table.workspaceId, table.createdAt),
    index('audit_log_actor_idx').on(table.actorId, table.createdAt),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
