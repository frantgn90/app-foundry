import type { App, Comment, CommentThread } from '../entities.js';
import type { Actor } from './context.js';
import { allow, type Decision, deny, DenialReason } from './result.js';
import { isActive } from './platform.js';

/**
 * Editar o borrar un comentario propio (RF-806).
 *
 * Un comentario ya borrado no se vuelve a tocar: el borrado es lógico para no
 * romper el hilo, no un estado del que se pueda salir.
 */
export function canEditOwnComment(actor: Actor, comment: Comment): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (comment.authorId !== actor.id) return deny(DenialReason.NOT_THE_AUTHOR);
  if (comment.deletedAt !== null) return deny(DenialReason.NOT_THE_AUTHOR);
  return allow();
}

/** El precursor de la app puede borrar cualquier hilo; el resto, solo el suyo (RF-806). */
export function canDeleteThread(actor: Actor, app: App, thread: CommentThread): Decision {
  if (!isActive(actor)) return deny(DenialReason.ACCOUNT_DEACTIVATED);
  if (app.precursorId === actor.id) return allow();
  if (thread.createdBy === actor.id) return allow();
  return deny(DenialReason.NOT_THE_AUTHOR);
}
