import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { apps, documentVersions } from './apps.js';
import { reviewStatusEnum } from './enums.js';
import { users } from './users.js';

/**
 * Una revisión: los agentes de la app leyendo la visión de un tirón (RF-1606).
 *
 * Es el gesto que convierte a los agentes de «alguien a quien preguntar» en
 * «alguien que te lee», y también el primer gesto caro del producto: cinco
 * agentes leyendo un documento entero son cinco invocaciones que alguien paga.
 * Por eso la fila guarda el **techo estimado** que se enseñó al confirmarla: es
 * lo que permite después comparar lo prometido con lo gastado.
 */
export const agentReviews = pgTable(
  'agent_reviews',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    /** Quien la pidió. Le basta con poder leer la app (RF-1608, D-12). */
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /**
     * La versión revisada, nunca la copia de trabajo (RF-1607, D-35).
     *
     * Va en la fila y no se deduce al vuelo porque el documento sigue vivo: si
     * mañana hay tres versiones más, esta revisión tiene que seguir diciendo
     * cuál leyó, que es la que explica sus comentarios.
     */
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    status: reviewStatusEnum('status').notNull().default('QUEUED'),
    /** El techo que se enseñó antes de confirmar (RF-1207). */
    estimatedTokens: bigint('estimated_tokens', { mode: 'number' }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * Dos revisiones de la misma app no se solapan (RF-1609), y no porque el
     * código se acuerde de mirarlo: un `SELECT` previo deja una carrera de
     * milisegundos entre comprobar y escribir, y el precio de perderla es pagar
     * dos revisiones enteras del mismo documento.
     */
    uniqueIndex('agent_reviews_one_live')
      .on(table.appId)
      .where(sql`status IN ('QUEUED', 'RUNNING')`),
    index('agent_reviews_app_idx').on(table.appId, table.createdAt),
  ],
);

/**
 * Lo que le toca a cada agente dentro de una revisión (T-33).
 *
 * Una fila por agente y no una por revisión porque es la unidad de todo lo
 * demás: el reintento, la idempotencia, la cancelación y el progreso. Un agente
 * lento no bloquea a los otros cuatro, y uno que falla no tira la revisión.
 */
export const agentReviewRuns = pgTable(
  'agent_review_runs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => agentReviews.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    status: reviewStatusEnum('status').notNull().default('QUEUED'),
    /** Cuántos hilos dejó escritos. Cero es un resultado, no un fallo. */
    threadsWritten: integer('threads_written').notNull().default(0),
    /**
     * La clave que hace que un reintento no escriba dos veces (T-33).
     *
     * Única en toda la tabla: la ejecución escribe sus hilos y su cambio de
     * estado en una sola transacción, así que un reintento que la encuentra
     * terminada no repite nada.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_review_runs_key').on(table.idempotencyKey),
    /* Un agente aparece una vez por revisión, y el motor lo garantiza. */
    uniqueIndex('agent_review_runs_agent').on(table.reviewId, table.agentId),
  ],
);
