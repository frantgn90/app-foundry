import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { apps } from './apps.js';
import { commentThreads } from './comments.js';
import { notificationTypeEnum } from './enums.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Un aviso dirigido a una persona concreta (RF-901).
 *
 * `payload` lleva ya redactado lo que hace falta para pintar la línea —quién
 * actuó, sobre qué app, un fragmento del texto— para no tener que reconstruirla
 * con joins contra tablas cuyo contenido puede haber cambiado o desaparecido.
 * Es una foto del momento, no una vista en vivo: si luego se borra el
 * comentario, el aviso sigue siendo legible en lugar de quedar en blanco.
 *
 * Las referencias a workspace, app e hilo sí son de verdad, y por dos motivos:
 * llevan al recurso al pulsar (RF-904) y permiten que el aviso deje de estar
 * accesible cuando se pierde el acceso (RF-906). Nunca guardan datos sensibles
 * (RF-706, RNF-112).
 *
 * Borrar el aviso no toca nada de lo que apunta (RF-911): de ahí que las bajas
 * vayan siempre en esta dirección y no en la contraria.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    /** A quién va dirigido. Es el eje de todo: de lectura, de purga y de RLS. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),

    /*
     * Todo aviso nace dentro de un workspace, y de ahí sale además quién puede
     * escribirlo y quién sigue teniendo derecho a verlo, así que no es opcional.
     */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    appId: uuid('app_id').references(() => apps.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => commentThreads.id, { onDelete: 'set null' }),

    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * El índice parcial es el que sostiene el contador de no leídas, que se
     * consulta en cada carga de página: solo indexa lo pendiente, que es la
     * parte pequeña y la única que se cuenta.
     */
    index('notifications_unread_idx')
      .on(t.userId, t.createdAt.desc())
      .where(sql`read_at IS NULL`),
    /** El listado completo, ya leídas incluidas. */
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    /** La purga por antigüedad barre por fecha sin mirar de quién es (RF-910). */
    index('notifications_created_idx').on(t.createdAt),
  ],
);

/**
 * Quién no quiere oír a qué agente (RF-1612).
 *
 * Silenciar es de la persona y del agente concreto, no del hilo ni de la app:
 * lo que molesta es un perfil que opina demasiado, y apagarlo entero —o
 * quitarlo de la app— es una decisión de otro que además afecta a todos.
 *
 * Silenciado sigue escribiendo. Lo que deja de llegar es el aviso, no el
 * comentario: apagarle la voz a alguien porque a uno le cansa sería decidir por
 * los demás lo que pueden leer.
 */
export const notificationAgentMutes = pgTable(
  'notification_agent_mutes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.agentId] }),
    index('notification_agent_mutes_agent_idx').on(table.agentId),
  ],
);
