import { AccessLevel, WorkspaceRole } from '../enums.js';
import type { AppContext } from './context.js';
import { allow, type Decision, deny, DenialReason } from './result.js';
import { isActive } from './platform.js';

/**
 * Puede ver la app (REQUIREMENTS §3.6).
 *
 * No hay excepción para el administrador de plataforma: gestiona cuentas, no
 * contenido (D-6). Que un admin no aparezca en este fichero es intencionado.
 */
export function canViewApp({ actor, membership, app }: AppContext): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (membership === null) return deny(DenialReason.NOT_A_MEMBER);
  if (app.accessLevel === AccessLevel.PRIVATE && app.precursorId !== actor.id) {
    return deny(DenialReason.APP_IS_PRIVATE);
  }
  return allow();
}

/** Puede editar el documento y los metadatos de la app (REQUIREMENTS §3.7). */
export function canEditApp(context: AppContext): Decision {
  const visible = canViewApp(context);
  if (!visible.allowed) return visible;

  const { actor, app } = context;
  if (app.archivedAt !== null) return deny(DenialReason.APP_IS_ARCHIVED);
  if (app.precursorId === actor.id) return allow();
  if (app.accessLevel === AccessLevel.WORKSPACE_WRITE) return allow();
  return deny(DenialReason.APP_IS_READ_ONLY);
}

/**
 * Puede comentar (RF-803).
 *
 * Comentar solo exige permiso de lectura: compartir una idea es pedir opinión, y
 * dejar sin voz a quien solo puede leer vaciaría de sentido `WORKSPACE_READ`.
 * Una app archivada deja sus comentarios en solo lectura (RF-812).
 */
export function canCommentOnApp(context: AppContext): Decision {
  const visible = canViewApp(context);
  if (!visible.allowed) return visible;
  if (context.app.archivedAt !== null) return deny(DenialReason.APP_IS_ARCHIVED);
  return allow();
}

/**
 * Puede cambiar el nivel de acceso (RF-406).
 *
 * Solo el precursor que además es dueño del workspace. Una app creada por un
 * invitado queda fijada en `WORKSPACE_WRITE` y no la cambia nadie: tampoco el
 * dueño del workspace, que no es su precursor (D-9).
 */
export function canChangeAccessLevel({ actor, membership, app }: AppContext): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (membership === null) return deny(DenialReason.NOT_A_MEMBER);
  if (app.precursorId !== actor.id) return deny(DenialReason.NOT_THE_PRECURSOR);
  if (membership.role !== WorkspaceRole.OWNER) return deny(DenialReason.ACCESS_LEVEL_IS_FIXED);
  return allow();
}

/** Archivar, desarchivar, eliminar y transferir son cosa del precursor (RF-409..411). */
export function canAdministerApp({ actor, membership, app }: AppContext): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (membership === null) return deny(DenialReason.NOT_A_MEMBER);
  if (app.precursorId !== actor.id) return deny(DenialReason.NOT_THE_PRECURSOR);
  return allow();
}

/** Cualquier miembro del workspace crea apps en él, sea dueño o invitado (RF-401). */
export function canCreateApp({ actor, membership }: Omit<AppContext, 'app'>): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (membership === null) return deny(DenialReason.NOT_A_MEMBER);
  return allow();
}

/**
 * Nivel de acceso con el que nace una app (RF-406, D-9).
 *
 * El dueño elige; un invitado no: lo que crea en casa ajena nace y permanece
 * compartido y editable. Nadie usa el espacio de otro como cajón privado.
 */
export function initialAccessLevel(
  role: WorkspaceRole,
  requested: AccessLevel = AccessLevel.PRIVATE,
): AccessLevel {
  return role === WorkspaceRole.OWNER ? requested : AccessLevel.WORKSPACE_WRITE;
}
