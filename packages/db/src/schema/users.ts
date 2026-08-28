import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { platformRoleEnum, userStatusEnum } from './enums.js';
import { citext } from './types.js';

/**
 * Cuentas de la plataforma.
 *
 * La identidad real es `githubId`, no el email ni el handle: ambos pueden
 * cambiar en GitHub sin que la persona deje de ser la misma, y se refrescan en
 * cada login (RF-104, RF-208).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    /** Nombre de usuario de GitHub: único por construcción, usado en menciones. */
    handle: citext('handle').notNull().unique(),
    email: citext('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    platformRole: platformRoleEnum('platform_role').notNull().default('MEMBER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('users_handle_idx').on(table.handle)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
