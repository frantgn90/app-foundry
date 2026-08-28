/**
 * Resultado de una comprobación de permisos.
 *
 * Devolver un motivo, y no un booleano, permite que la API responda con un 403
 * que explica qué falta y que los tests digan por qué se deniega, no solo que se
 * deniega. Cuando dos reglas distintas prohíben lo mismo, el motivo es lo único
 * que las distingue.
 */
export const DenialReason = {
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  NOT_THE_PRECURSOR: 'NOT_THE_PRECURSOR',
  NOT_THE_OWNER: 'NOT_THE_OWNER',
  APP_IS_PRIVATE: 'APP_IS_PRIVATE',
  APP_IS_READ_ONLY: 'APP_IS_READ_ONLY',
  APP_IS_ARCHIVED: 'APP_IS_ARCHIVED',
  ACCESS_LEVEL_IS_FIXED: 'ACCESS_LEVEL_IS_FIXED',
  OWNER_CANNOT_LEAVE: 'OWNER_CANNOT_LEAVE',
  NOT_THE_AUTHOR: 'NOT_THE_AUTHOR',
} as const;
export type DenialReason = (typeof DenialReason)[keyof typeof DenialReason];

export type Decision = { allowed: true } | { allowed: false; reason: DenialReason };

export const allow = (): Decision => ({ allowed: true });
export const deny = (reason: DenialReason): Decision => ({ allowed: false, reason });
