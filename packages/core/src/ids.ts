/**
 * Identificadores con marca de tipo.
 *
 * Todos son UUIDv7 en tiempo de ejecución (TRD T-12), pero distinguirlos en el
 * sistema de tipos evita la clase de error más tonta y más cara de este dominio:
 * pasar el identificador de un usuario donde se espera el de una app.
 */
declare const brand: unique symbol;

type Branded<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Branded<string, 'UserId'>;
export type WorkspaceId = Branded<string, 'WorkspaceId'>;
export type AppId = Branded<string, 'AppId'>;
export type DocumentId = Branded<string, 'DocumentId'>;
export type VersionId = Branded<string, 'VersionId'>;
export type ThreadId = Branded<string, 'ThreadId'>;
export type CommentId = Branded<string, 'CommentId'>;

export const asUserId = (value: string): UserId => value as UserId;
export const asWorkspaceId = (value: string): WorkspaceId => value as WorkspaceId;
export const asAppId = (value: string): AppId => value as AppId;
export const asDocumentId = (value: string): DocumentId => value as DocumentId;
export const asVersionId = (value: string): VersionId => value as VersionId;
export const asThreadId = (value: string): ThreadId => value as ThreadId;
export const asCommentId = (value: string): CommentId => value as CommentId;
