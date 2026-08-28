import { PlatformRole, UserStatus } from '../enums.js';
import type { Actor } from './context.js';
import { allow, type Decision, deny, DenialReason } from './result.js';

export const isActive = (actor: Actor): boolean => actor.status === UserStatus.ACTIVE;

/** Gestionar cuentas: altas, bajas y roles de plataforma (RF-201..203). */
export function canManageAccounts(actor: Actor): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (actor.platformRole !== PlatformRole.ADMIN) return deny(DenialReason.NOT_THE_OWNER);
  return allow();
}

/**
 * El administrador de plataforma **no** accede al contenido de workspaces ajenos
 * (D-6, RF-204).
 *
 * Existe como función y no como comentario para que la regla sea comprobable: si
 * algún día alguien introduce una excepción "temporal" para depurar, el test que
 * acompaña a esta función se pondrá rojo.
 */
export function platformAdminHasContentAccess(): false {
  return false;
}
