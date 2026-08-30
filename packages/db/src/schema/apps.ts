import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { accessLevelEnum, appStatusEnum, documentTypeEnum } from './enums.js';
import { citext } from './types.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Una app es una idea. Es la unidad central del producto.
 *
 * Pertenece siempre al workspace donde se creó: si su precursor deja ese
 * workspace, la app se queda y el rol pasa al dueño (RF-413).
 */
export const apps = pgTable(
  'apps',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    slug: citext('slug').notNull(),
    name: text('name').notNull(),
    shortDescription: text('short_description'),
    status: appStatusEnum('status').notNull().default('IDEA'),
    accessLevel: accessLevelEnum('access_level').notNull().default('PRIVATE'),
    /** Quien creó la app, o quien heredó el rol. Transferible (RF-408). */
    precursorId: uuid('precursor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    iconEmoji: text('icon_emoji').notNull(),
    iconColor: text('icon_color').notNull(),
    /** Informativo en v1: no sincroniza nada (RF-417). */
    repoUrl: text('repo_url'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /*
     * Lo que se busca, mantenido por la base de datos (RF-604, TRD §10).
     *
     * Se declara aquí para que el esquema no mienta, pero nadie lo escribe desde
     * la aplicación: lo recalculan disparadores cuando cambia el nombre, la
     * descripción, el texto de la visión o las etiquetas. Dejarlo en manos de
     * quien guarda significaría que el día que se añada otro camino de escritura
     * —una importación, el servidor MCP— la búsqueda empezaría a mentir sin que
     * nada fallara.
     */
    searchTsv: customType<{ data: string; driverData: string }>({
      dataType: () => 'tsvector',
    })('search_tsv'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('apps_workspace_slug_unique').on(table.workspaceId, table.slug),
    // El listado por defecto ordena por actividad reciente dentro de un
    // workspace, así que este índice es el que sostiene la vista principal.
    index('apps_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    index('apps_precursor_idx').on(table.precursorId),
    index('apps_search_idx').using('gin', table.searchTsv),
  ],
);

export const appTags = pgTable(
  'app_tags',
  {
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    tag: citext('tag').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.tag] }),
    index('app_tags_tag_idx').on(table.tag),
  ],
);

/**
 * Documento de una app.
 *
 * `type` es un enum desde el principio para que añadir PRD y TRD sea añadir un
 * valor y no rehacer el modelo (RF-514, RD-4). En v1 solo se crea VISION.
 *
 * `currentContent` duplica el contenido de la versión actual a propósito: evita
 * un join en cada lectura y en cada búsqueda, y se actualiza en la misma
 * transacción que crea la versión. La fuente de verdad histórica sigue siendo
 * `document_versions`.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    type: documentTypeEnum('type').notNull(),
    /**
     * Nullable solo durante el instante entre crear el documento y su primera
     * versión: sin eso, las dos tablas se referenciarían en círculo y no habría
     * forma de insertar ni una.
     */
    currentVersionId: uuid('current_version_id').references(
      (): AnyPgColumn => documentVersions.id,
      { onDelete: 'set null' },
    ),
    currentContent: text('current_content').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('documents_app_type_unique').on(table.appId, table.type)],
);

/** Versiones inmutables. Nada las modifica: solo se añaden (RF-505). */
export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    documentId: uuid('document_id')
      .notNull()
      .references((): AnyPgColumn => documents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    content: text('content').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('document_versions_no_unique').on(table.documentId, table.versionNo),
    index('document_versions_document_idx').on(table.documentId, table.createdAt),
    // Los contribuidores se derivan de aquí, sin concederlos a nadie (RF-509).
    index('document_versions_author_idx').on(table.authorId),
  ],
);

export type AppRow = typeof apps.$inferSelect;
export type NewAppRow = typeof apps.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
