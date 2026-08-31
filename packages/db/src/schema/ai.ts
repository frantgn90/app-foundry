import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  bigint,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { aiOutcomeEnum, aiProviderEnum, aiTaskEnum, providerStatusEnum } from './enums.js';
import { bytea } from './types.js';
import { apps } from './apps.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Un proveedor de modelos configurado en un workspace (RF-1001..1006).
 *
 * La credencial **no** está aquí: vive en su propia tabla, sin permiso de
 * lectura para el rol de la aplicación (T-27). Esta guarda todo lo que sí puede
 * viajar a la interfaz —estado, cupo, la pista para reconocer la clave— y por
 * eso se puede consultar con normalidad.
 */
export const workspaceAiProviders = pgTable(
  'workspace_ai_providers',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: aiProviderEnum('provider').notNull(),
    status: providerStatusEnum('status').notNull().default('ACTIVE'),
    /**
     * Los últimos caracteres de la clave, para reconocerla de un vistazo.
     *
     * Es lo **único** de la credencial que llega al cliente (RF-1004): con
     * cuatro caracteres se distingue una clave de otra y no se reconstruye
     * ninguna.
     */
    credentialHint: text('credential_hint').notNull(),
    /**
     * Techo mensual de tokens de este proveedor (RF-1204). Nulo es sin cupo.
     *
     * Va por proveedor y no por workspace porque un millón de tokens no vale lo
     * mismo en cada uno: un cupo único mediría volumen, no gasto (D-30).
     */
    monthlyTokenQuota: bigint('monthly_token_quota', { mode: 'number' }),
    /** A qué porcentaje del cupo se avisa a su dueño (RF-1205). */
    quotaAlertPct: smallint('quota_alert_pct').notNull().default(80),
    /** Cuándo se comprobó por última vez que la credencial sirve (RF-1005). */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workspace_ai_providers_workspace_provider_key').on(table.workspaceId, table.provider),
    index('workspace_ai_providers_workspace_idx').on(table.workspaceId),
  ],
);

/**
 * El secreto, aparte (T-27, RNF-601, RNF-602).
 *
 * Está en su propia tabla por una razón concreta: la Row-Level Security filtra
 * **filas, no columnas**. Mientras el texto cifrado conviviera con el estado y
 * el cupo, cualquier consulta legítima a la configuración lo arrastraría, y
 * bastaría un `select *` despistado en un endpoint para publicarlo.
 *
 * Aquí el rol de la aplicación no tiene `SELECT` en absoluto: la única vía de
 * lectura es una función acotada que devuelve el cifrado de un par concreto
 * (misma idea que T-19 usó para el login).
 */
export const workspaceAiCredentials = pgTable(
  'workspace_ai_credentials',
  {
    workspaceId: uuid('workspace_id').notNull(),
    provider: aiProviderEnum('provider').notNull(),
    /** Texto cifrado con AES-256-GCM, etiqueta de autenticación incluida. */
    ciphertext: bytea('ciphertext').notNull(),
    /** Número usado una sola vez. Distinto en cada cifrado, nunca reutilizado. */
    nonce: bytea('nonce').notNull(),
    /**
     * Con qué versión de la clave maestra se cifró (T-26).
     *
     * Es lo que permite rotar: durante la rotación conviven una clave que solo
     * descifra y otra que además cifra, y cada fila dice cuál le toca.
     */
    keyVersion: integer('key_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.provider] }),
    /*
     * Cuelga del proveedor, no del workspace: borrar la configuración se lleva
     * el secreto en la misma operación, sin dejar huérfano lo que más importa
     * que no se quede por ahí.
     */
    foreignKey({
      columns: [table.workspaceId, table.provider],
      foreignColumns: [workspaceAiProviders.workspaceId, workspaceAiProviders.provider],
      name: 'workspace_ai_credentials_provider_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Caché del catálogo de modelos de cada proveedor (T-28, RF-1007).
 *
 * No es una tabla de negocio: es lo que el proveedor publica sobre sí mismo, y
 * es igual para todos los workspaces. Por eso no lleva `workspace_id` —guardar
 * una copia por workspace sería multiplicar la misma información y multiplicar
 * también las llamadas para refrescarla—.
 *
 * Se guarda en la base de datos y no en memoria para que sobreviva a un
 * reinicio: con el proveedor caído, lo último que se supo sigue sirviendo
 * (RF-1009).
 *
 * **No hay precios.** Ninguno de los dos los publica por API, y una tabla
 * propia de tarifas envejece mal y aparenta una precisión que no tenemos: el
 * consumo se mide en tokens (D-37).
 */
export const aiModels = pgTable(
  'ai_models',
  {
    provider: aiProviderEnum('provider').notNull(),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    /** Cero significa **no lo sé**, nunca «cabe todo» (RF-1106). */
    contextWindow: integer('context_window').notNull().default(0),
    maxOutputTokens: integer('max_output_tokens').notNull().default(0),
    /**
     * Si el proveedor lo sigue ofreciendo.
     *
     * Los que desaparecen no se borran: se marcan. Borrarlos dejaría sin
     * explicación las asignaciones que apuntaban a ellos, y lo que hay que
     * hacer es avisar a su dueño (RF-1009).
     */
    available: boolean('available').notNull().default(true),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.modelId] })],
);

/**
 * Qué modelo atiende cada tipo de tarea en este workspace (RF-1101, RF-1102).
 *
 * La asignación es **por tipo de tarea** y no por función ni por usuario: es
 * donde el dueño decide en qué gasta su cuota, y lo que hace útil tener dos
 * proveedores a la vez —uno rápido para reescribir un párrafo, uno capaz para
 * razonar— (D-34).
 *
 * Cuelga del proveedor configurado, así que borrarlo se lleva por delante sus
 * asignaciones: una tarea apuntando a un proveedor que ya no está sería una
 * invocación que falla en el momento más inoportuno. Lo que queda entonces es
 * una tarea sin asignar, que la interfaz sabe explicar (RF-1006).
 */
export const workspaceTaskModels = pgTable(
  'workspace_task_models',
  {
    workspaceId: uuid('workspace_id').notNull(),
    task: aiTaskEnum('task').notNull(),
    provider: aiProviderEnum('provider').notNull(),
    modelId: text('model_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.task] }),
    foreignKey({
      columns: [table.workspaceId, table.provider],
      foreignColumns: [workspaceAiProviders.workspaceId, workspaceAiProviders.provider],
      name: 'workspace_task_models_provider_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Una llamada a un modelo, con lo que costó (RF-1201, RD-10).
 *
 * Es la **verdad** del consumo: el contador de Redis es una caché derivable de
 * esta tabla, y de aquí se reconstruye cuando hace falta (§9.3 del TRD v2).
 *
 * **No guarda contenido**: ni el prompt, ni el documento, ni la respuesta
 * (RF-1202, RNF-112). Mide, no archiva.
 *
 * Entrada y salida van separadas siempre. Hoy no calculamos importes porque
 * nadie publica sus tarifas, pero guardarlas por separado permite valorar el
 * histórico entero el día que haga falta, sin haber perdido un dato (D-37).
 */
export const aiInvocations = pgTable(
  'ai_invocations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** La app sobre la que se invocó, si fue sobre alguna. */
    appId: uuid('app_id').references(() => apps.id, { onDelete: 'set null' }),
    /**
     * Quién la provocó.
     *
     * Se conserva el consumo aunque la cuenta desaparezca: lo gastado ya se
     * gastó, y borrarlo descuadraría el mes.
     */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    task: aiTaskEnum('task').notNull(),
    provider: aiProviderEnum('provider').notNull(),
    modelId: text('model_id').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Hasta la primera palabra: es lo que se nota al usarlo (RNF-706). */
    ttftMs: integer('ttft_ms'),
    latencyMs: integer('latency_ms'),
    outcome: aiOutcomeEnum('outcome').notNull(),
    /** El `kind` de la taxonomía cuando falló. Nunca el mensaje del proveedor. */
    errorKind: text('error_kind'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_invocations_workspace_idx').on(table.workspaceId, table.createdAt),
    /** Para reconstruir el contador de un mes y proveedor sin recorrer la tabla. */
    index('ai_invocations_quota_idx').on(table.workspaceId, table.provider, table.createdAt),
  ],
);
