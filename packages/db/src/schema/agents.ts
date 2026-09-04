import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { aiProviderEnum } from './enums.js';
import { citext } from './types.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Un perfil reutilizable definido en el workspace (RF-1501, RF-1502).
 *
 * Es el molde, no el interlocutor: quien firma un comentario es siempre una
 * **instancia** en una app concreta. Separarlos es lo que permite ajustar la
 * personalidad para una app sin tocar el resto (RF-1504) y lo que hace que
 * editar el molde no reescriba lo que ya dijeron sus copias (RF-1505).
 *
 * Las plantillas de fábrica no viven aquí ni en ninguna otra tabla: son datos
 * del producto, y adoptar una copia sus campos a una fila de estas y corta el
 * vínculo (RF-1513, RF-1514).
 */
export const agentTemplates = pgTable(
  'agent_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * Con lo que se le llama en un comentario.
     *
     * `citext` por lo mismo que el de una persona: quien escribe `@Marketing`
     * está llamando al mismo de siempre. Único en el workspace, no en la
     * instancia: dos workspaces pueden tener cada uno su `@techlead` sin
     * enterarse el uno del otro.
     */
    handle: citext('handle').notNull(),
    iconEmoji: text('icon_emoji').notNull(),
    iconColor: text('icon_color').notNull(),
    /**
     * La personalidad, en texto.
     *
     * Va aquí y no en una tabla de revisiones porque una plantilla no tiene
     * historia que conservar: nada cuelga de ella. Lo que sí la tiene es la
     * instancia, porque sus comentarios apuntan a la revisión con la que se
     * escribieron (RF-1510).
     */
    prompt: text('prompt').notNull(),
    /**
     * Modelo propio, si se le quiere fijar uno (RF-1104).
     *
     * Nulo es lo normal: entonces usa el que el workspace tenga asignado al
     * tipo de tarea. Los dos campos van juntos o no van: un modelo sin
     * proveedor no identifica a nadie.
     */
    provider: aiProviderEnum('provider'),
    modelId: text('model_id'),
    /** Retirada del catálogo del workspace sin perder las instancias vivas. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /**
     * Quién la creó. Se pone a nulo si la cuenta desaparece: la plantilla es
     * del workspace, y quedarse sin autor no la invalida.
     */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('agent_templates_workspace_handle_key').on(table.workspaceId, table.handle)],
);

export type AgentTemplateRow = typeof agentTemplates.$inferSelect;
