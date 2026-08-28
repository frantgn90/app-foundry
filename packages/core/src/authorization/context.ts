import type { App, User, WorkspaceMembership } from '../entities.js';

/** Lo mínimo que hace falta saber de quien actúa. */
export type Actor = Pick<User, 'id' | 'platformRole' | 'status'>;

/**
 * Contexto de una decisión sobre una app.
 *
 * `membership` es la del actor **en el workspace de la app**, o `null` si no
 * pertenece a él. Ese `null` es la puerta cerrada: sin membresía no hay nada que
 * decidir después.
 */
export interface AppContext {
  actor: Actor;
  membership: WorkspaceMembership | null;
  app: App;
}

export interface WorkspaceContext {
  actor: Actor;
  membership: WorkspaceMembership | null;
}
