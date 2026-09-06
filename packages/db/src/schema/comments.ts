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

import { agentPromptRevisions, agents } from './agents.js';
import { apps, documents, documentVersions } from './apps.js';
import { agentReviews } from './reviews.js';
import { aiProviderEnum, anchorStatusEnum, threadKindEnum, threadStatusEnum } from './enums.js';
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
    /**
     * Posición en el fuente de **su** versión. Inmutable como ella: el fragmento
     * anotado no cambia nunca bajo el comentario (RF-808).
     */
    anchorStart: integer('anchor_start'),
    anchorEnd: integer('anchor_end'),
    /**
     * La versión a la que pertenece el hilo (RF-817). Null en los generales, que
     * son de la app: la conversación sobre la idea no se cierra al commitear.
     */
    anchoredVersionId: uuid('anchored_version_id').references(() => documentVersions.id, {
      onDelete: 'set null',
    }),
    anchorStatus: anchorStatusEnum('anchor_status'),

    /**
     * De qué revisión salió el hilo, si lo abrió una (RF-1606).
     *
     * Nulo en todo lo que abre una persona, y también en lo que abre un agente
     * al que se menciona: solo lo lleva lo que salió del abanico. Se queda si la
     * revisión desaparece, porque el comentario sigue siendo suyo.
     */
    reviewId: uuid('review_id').references((): AnyPgColumn => agentReviews.id, {
      onDelete: 'set null',
    }),

    /**
     * Dónde cae el fragmento en la copia de trabajo, que va por delante de la
     * versión mientras haya cambios sin commitear. Se recalcula en cada guardado
     * y se limpia al commitear, cuando la versión nueva vuelve a coincidir con
     * lo que se ve (§9.3).
     */
    workingStart: integer('working_start'),
    workingEnd: integer('working_end'),
    workingStatus: anchorStatusEnum('working_status'),

    /**
     * Quién lo abrió, si fue una persona (T-34).
     *
     * Deja de ser obligatorio porque un agente también abre hilos, y entonces
     * el que lleva valor es el de al lado. Que sea **exactamente uno** de los
     * dos no queda al criterio de quien escriba el INSERT: lo garantiza un
     * `CHECK` del motor, porque un hilo sin autor no se puede leer y uno con
     * dos no se puede creer.
     */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    /** Quién lo abrió, si fue un agente de esta app (T-34). */
    createdByAgentId: uuid('created_by_agent_id').references(() => agents.id),
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
    /** El autor, si es una persona. Excluyente con el de agente (T-34). */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'restrict' }),
    /** El autor, si es un agente de la app del hilo (T-34). */
    authorAgentId: uuid('author_agent_id').references(() => agents.id),
    /**
     * Con qué perfil lo escribió (RF-1510).
     *
     * Un puntero y no una copia del prompt: la revisión es inmutable, así que
     * apuntar y copiar valen lo mismo, y copiar costaría kilobytes por línea.
     * Va y viene con `authorAgentId`: los dos o ninguno.
     */
    agentPromptRevisionId: uuid('agent_prompt_revision_id').references(
      () => agentPromptRevisions.id,
    ),
    /**
     * Con qué se generó, para poder decirlo en el propio comentario (RF-1704).
     *
     * Se guarda aquí y no se deduce del registro de invocaciones porque lo que
     * hay que contestar es de **este** comentario, y una invocación no apunta a
     * ninguno: sacarlo por fecha y agente sería adivinar. Y porque el modelo
     * asignado a la tarea cambia, así que preguntar hoy por lo que se usó ayer
     * daría la respuesta de hoy.
     *
     * Van con `authorAgentId`: un comentario de persona no se generó con nada.
     */
    aiProvider: aiProviderEnum('ai_provider'),
    aiModelId: text('ai_model_id'),
    /**
     * Lo que el modelo se dijo a sí mismo antes de contestar (RF-1403, RD-9).
     *
     * Se guarda aparte del cuerpo por lo mismo que en el asistente: aparte es lo
     * que impide que acabe en el comentario, y guardado es lo que permite
     * enseñarlo plegado cuando alguien quiere entender por qué el agente dijo lo
     * que dijo. Solo lo llenan los modelos que piensan en voz alta.
     */
    aiReasoning: text('ai_reasoning'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('comments_thread_idx').on(table.threadId, table.createdAt),
    index('comments_author_idx').on(table.authorId),
    /**
     * Cuántas veces ha hablado ya un agente en este hilo: es la consulta del
     * cortafuegos de turnos (RF-1605), y se hace antes de cada intervención.
     */
    index('comments_author_agent_idx').on(table.authorAgentId, table.threadId),
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

/**
 * A qué agente se invoca en un comentario (RF-1602, T-34).
 *
 * Tabla aparte de `comment_mentions` y no una columna más en ella, aunque las
 * dos salgan de leer `@algo` en el mismo texto. Son dos comportamientos: una
 * **avisa** a una persona y la otra **invoca** a un agente, que cuesta tokens y
 * escribe en el documento. Separarlas mantiene además cada clave ajena
 * obligatoria en vez de dejar dos columnas opcionales que se turnan.
 *
 * Aquí no entra lo que menciona un agente: una mención escrita por un agente no
 * invoca a nadie (RF-1604). Quién dispara y cuándo se decide en el consumidor
 * del evento (T-35), pero la mitad estructural está en el motor: un trigger
 * impide que se escriba una fila cuyo comentario no lo firme una persona, y
 * otra cuyo agente sea de otra app (RF-1512). Sin fila no hay invocación.
 */
export const commentAgentMentions = pgTable(
  'comment_agent_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.agentId] }),
    index('comment_agent_mentions_agent_idx').on(table.agentId),
  ],
);

export type CommentThreadRow = typeof commentThreads.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
