import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { apps, documents, documentVersions } from './apps.js';
import { anchorStatusEnum, threadKindEnum, threadStatusEnum } from './enums.js';
import { users } from './users.js';

/**
 * Un hilo de conversación sobre una app.
 *
 * Hay dos clases: el hilo general, al pie del documento, y los inline, anclados
 * a un fragmento concreto del texto.
 *
 * Los campos de anclaje siguen el modelo de anotación del W3C: se guarda la
 * **posición** y también la **cita** con su contexto, porque el documento sigue
 * editándose y la posición caduca. Cuando el fragmento desaparece, el hilo pasa
 * a huérfano en lugar de borrarse o pegarse donde no toca (RF-809).
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: threadKindEnum('kind').notNull(),
    status: threadStatusEnum('status').notNull().default('OPEN'),

    /** Texto exacto sobre el que se comentó. Es lo que permite reanclar. */
    anchorQuote: text('anchor_quote'),
    /** Contexto a cada lado: desambigua cuando la cita aparece varias veces. */
    anchorPrefix: text('anchor_prefix'),
    anchorSuffix: text('anchor_suffix'),
    anchorStart: integer('anchor_start'),
    anchorEnd: integer('anchor_end'),
    /** Versión en la que se comentó, para poder mostrar el contexto original. */
    anchoredVersionId: uuid('anchored_version_id').references(() => documentVersions.id, {
      onDelete: 'set null',
    }),
    anchorStatus: anchorStatusEnum('anchor_status'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comment_threads_app_status_idx').on(table.appId, table.status),
    index('comment_threads_document_idx').on(table.documentId),
  ],
);

/**
 * Un comentario dentro de un hilo.
 *
 * `parentId` admite un solo nivel de anidamiento (RF-804): un comentario raíz y
 * sus respuestas. Lo garantiza un trigger, no solo la interfaz.
 *
 * `deletedAt` es borrado lógico: borrar de verdad dejaría huecos en una
 * conversación y rompería las respuestas que colgaban de ese comentario.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comments_thread_idx').on(table.threadId, table.createdAt),
    index('comments_author_idx').on(table.authorId),
  ],
);

/** A quién se menciona en un comentario (RF-814). */
export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index('comment_mentions_user_idx').on(table.userId),
  ],
);

export type CommentThreadRow = typeof commentThreads.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
