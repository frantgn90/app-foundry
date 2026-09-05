import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { apps } from './apps.js';
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
     * Cuántas palabras como mucho puede escribir en una respuesta.
     *
     * **Cero es sin límite**, y es lo que viene de fábrica: la mayoría de las
     * veces lo que se quiere es que conteste lo que tenga que contestar. Se
     * pone un número cuando un perfil concreto se va por las ramas, que es una
     * decisión sobre *ese* agente y no sobre todos.
     *
     * Va aquí y no en la configuración de la instancia porque no es una
     * salvaguarda del sistema —esa es el techo de tokens, que sigue estando—
     * sino una preferencia sobre cómo habla cada uno.
     */
    replyWordLimit: integer('reply_word_limit').notNull().default(0),
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

/**
 * Un agente: la instancia de una plantilla dentro de una app (RF-1503).
 *
 * Es quien firma. Nace copiando los campos de su plantilla y a partir de ahí
 * vive su vida: el prompt se ajusta para esta app sin tocar el molde (RF-1504),
 * y editar el molde no vuelve aquí (RF-1505).
 *
 * `templateId` se pone a nulo si la plantilla se borra, en vez de arrastrar al
 * agente con ella: lo que un agente escribió sigue siendo suyo aunque el molde
 * del que salió ya no exista.
 *
 * Los agentes de una app **no** son visibles ni mencionables desde otra, aunque
 * compartan plantilla y workspace (RF-1512). Eso lo sostiene el `app_id`: no
 * hay ninguna consulta que llegue a un agente sin pasar por su app.
 */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    /** De qué molde salió, mientras el molde exista (RF-1504, RF-1509). */
    templateId: uuid('template_id').references((): AnyPgColumn => agentTemplates.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    handle: citext('handle').notNull(),
    iconEmoji: text('icon_emoji').notNull(),
    iconColor: text('icon_color').notNull(),
    /**
     * Cuántas palabras como mucho puede escribir en una respuesta.
     *
     * **Cero es sin límite**, y es lo que viene de fábrica: la mayoría de las
     * veces lo que se quiere es que conteste lo que tenga que contestar. Se
     * pone un número cuando un perfil concreto se va por las ramas, que es una
     * decisión sobre *ese* agente y no sobre todos.
     *
     * Va aquí y no en la configuración de la instancia porque no es una
     * salvaguarda del sistema —esa es el techo de tokens, que sigue estando—
     * sino una preferencia sobre cómo habla cada uno.
     */
    replyWordLimit: integer('reply_word_limit').notNull().default(0),
    provider: aiProviderEnum('provider'),
    modelId: text('model_id'),
    /**
     * Callado sin retirarse (RF-1508).
     *
     * Deja de intervenir y sus comentarios se quedan donde están. Es distinto
     * de `removedAt`: uno es un descanso y el otro una despedida, y lo que hay
     * que hacer para deshacerlos no es lo mismo.
     */
    active: boolean('active').notNull().default(true),
    /**
     * Retirado de la app, sin borrar lo que escribió (RF-1509).
     *
     * Lógico y no físico por lo mismo que con una persona (RF-813): borrar la
     * fila dejaría sus comentarios sin autoría, y la conversación en la que
     * participó dejaría de entenderse.
     *
     * Retirar implica apagar: un `CHECK` del motor impide que esta fecha y un
     * `active` verdadero convivan, porque de `active` cuelga el disparo y un
     * retirado «activo» seguiría contestando en una app de la que ya se le
     * sacó. Se ponen las dos cosas en el mismo movimiento.
     */
    removedAt: timestamp('removed_at', { withTimezone: true }),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Único entre los que siguen en la app, no entre todos los que pasaron por
     * ella (RF-1506).
     *
     * Con un único total, retirar a `@po` dejaría ese handle quemado para
     * siempre en esa app: nadie podría volver a tener uno, ni el mismo perfil
     * al recuperarlo. Parcial, el nombre se libera al retirarse y lo escrito
     * por el retirado conserva su autoría.
     */
    uniqueIndex('agents_app_handle_key')
      .on(table.appId, table.handle)
      .where(sql`${table.removedAt} IS NULL`),
    index('agents_template_idx').on(table.templateId),
  ],
);

export type AgentRow = typeof agents.$inferSelect;

/**
 * El prompt de un agente, versión a versión (RF-1510).
 *
 * El vigente es el de número más alto. No está en `agents` porque cada
 * comentario apunta a **la revisión concreta** con la que se escribió: ajustar
 * la personalidad después no debe reescribir la historia de por qué el agente
 * dijo lo que dijo.
 *
 * Se guarda el puntero y no una copia del texto en cada comentario. Duplicar
 * kilobytes por línea escrita sería tirar el espacio, y la pregunta que hay que
 * poder contestar —«¿con qué perfil escribió esto?»— se contesta igual de bien
 * desde aquí.
 */
export const agentPromptRevisions = pgTable(
  'agent_prompt_revisions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /**
     * Correlativo dentro del agente, empezando en 1.
     *
     * Un número y no solo la fecha: «la revisión 2» se dice, se enseña y se
     * compara, y dos revisiones creadas en el mismo milisegundo seguirían
     * teniendo un orden.
     */
    revision: integer('revision').notNull(),
    prompt: text('prompt').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('agent_prompt_revisions_agent_revision_key').on(table.agentId, table.revision),
  ],
);

export type AgentPromptRevisionRow = typeof agentPromptRevisions.$inferSelect;
