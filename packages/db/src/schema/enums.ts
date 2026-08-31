import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Enums nativos de Postgres.
 *
 * Los valores se mantienen sincronizados con los del dominio en
 * `@app-foundry/core`: un test de contrato comprueba que no divergen, porque un
 * enum que existe en dos sitios acaba divergiendo si nadie lo vigila.
 */
export const platformRoleEnum = pgEnum('platform_role', ['ADMIN', 'MEMBER']);
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DEACTIVATED']);
export const workspaceRoleEnum = pgEnum('workspace_role', ['OWNER', 'MEMBER']);
export const appStatusEnum = pgEnum('app_status', [
  'IDEA',
  'DEFINING',
  'IN_DEVELOPMENT',
  'PUBLISHED',
  'PAUSED',
  'ARCHIVED',
]);
export const accessLevelEnum = pgEnum('access_level', [
  'PRIVATE',
  'WORKSPACE_READ',
  'WORKSPACE_WRITE',
]);
export const documentTypeEnum = pgEnum('document_type', ['VISION', 'PRD', 'TRD']);
export const threadKindEnum = pgEnum('thread_kind', ['GENERAL', 'INLINE']);
export const threadStatusEnum = pgEnum('thread_status', ['OPEN', 'RESOLVED']);
export const anchorStatusEnum = pgEnum('anchor_status', ['ANCHORED', 'ORPHANED']);
export const invitationStatusEnum = pgEnum('invitation_status', [
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED',
]);

/**
 * Qué ha pasado para que a alguien le llegue un aviso (RF-902).
 *
 * El tipo decide cómo se redacta y adónde lleva al pulsarlo, así que vive aquí
 * y no como cadena suelta: añadir un caso obliga a decidir ambas cosas.
 */
export const notificationTypeEnum = pgEnum('notification_type', [
  'WORKSPACE_INVITED',
  'APP_COMMENTED',
  'THREAD_REPLIED',
  'THREAD_RESOLVED',
  'MENTIONED',
  'DOCUMENT_VERSION_SAVED',
  'PRECURSOR_TRANSFERRED',
  'APPS_INHERITED',
  'AI_MODEL_UNAVAILABLE',
]);

/**
 * Proveedor de modelos configurado en un workspace (RF-1001).
 *
 * Se mantiene sincronizado con `AiProvider` de `@app-foundry/core`. El
 * proveedor de mentira de las pruebas **no** aparece aquí: suplanta a uno real
 * en el registro de adaptadores, de modo que la base de datos recorre el mismo
 * camino que en producción (T-36).
 */
export const aiProviderEnum = pgEnum('ai_provider', ['ANTHROPIC', 'GROQ']);

/**
 * En qué estado está un proveedor configurado.
 *
 * `INVALID` es distinto de `DISABLED`: uno lo apagó su dueño y el otro dejó de
 * funcionar solo —credencial revocada—, y lo que hay que hacer para arreglarlo
 * no es lo mismo (RF-1006).
 */
export const providerStatusEnum = pgEnum('provider_status', ['ACTIVE', 'DISABLED', 'INVALID']);

/**
 * Para qué se invoca a un modelo (RF-1101).
 *
 * Sincronizado con `AiTask` de `@app-foundry/core`. Es un enum y no una tabla
 * porque añadir un uso nuevo de IA es una decisión de producto, no un dato que
 * alguien dé de alta (RD-11).
 */
export const aiTaskEnum = pgEnum('ai_task', [
  'IDEA_GENERATION',
  'TEXT_ASSIST',
  'AGENT_REVIEW',
  'AGENT_REPLY',
]);
