import { sql } from 'drizzle-orm';
import { customType, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/** `inet` de Postgres: Drizzle no lo trae de serie. */
const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

/**
 * Sesiones opacas respaldadas por la base de datos.
 *
 * Es lo único que cumple RF-110 de verdad: desactivar una cuenta borra sus
 * sesiones y el acceso cae al instante, algo que un JWT no permite sin
 * reinventar esta misma tabla.
 *
 * Del token solo se guarda su SHA-256: quien lea la base de datos no puede
 * suplantar a nadie.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    /**
     * IP truncada (/24 en IPv4, /48 en IPv6): sirve para que alguien reconozca
     * una sesión suya, no para rastrearle (RF-706, RNF-112).
     */
    ipPrefix: inet('ip_prefix'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
