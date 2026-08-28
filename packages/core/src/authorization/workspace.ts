import { WorkspaceRole } from '../enums.js';
import type { WorkspaceContext } from './context.js';
import { allow, type Decision, deny, DenialReason } from './result.js';
import { isActive } from './platform.js';

/** Invitar, expulsar y renombrar son cosa del dueño (RF-304, RF-307, RF-303). */
export function canAdministerWorkspace({ actor, membership }: WorkspaceContext): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (membership === null) return deny(DenialReason.NOT_A_MEMBER);
  if (membership.role !== WorkspaceRole.OWNER) return deny(DenialReason.NOT_THE_OWNER);
  return allow();
}

/**
 * Abandonar un workspace (RF-308).
 *
 * El dueño no puede irse del suyo: dejaría el espacio y sus apps sin responsable
 * (RF-310).
 */
export function canLeaveWorkspace({ actor, membership }: WorkspaceContext): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (membership === null) return deny(DenialReason.NOT_A_MEMBER);
  if (membership.role === WorkspaceRole.OWNER) return deny(DenialReason.OWNER_CANNOT_LEAVE);
  return allow();
}
