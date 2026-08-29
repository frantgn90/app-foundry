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
]);
