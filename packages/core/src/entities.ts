import type {
  AccessLevel,
  AnchorStatus,
  AppStatus,
  DocumentType,
  PlatformRole,
  ThreadKind,
  ThreadStatus,
  UserStatus,
  WorkspaceRole,
} from './enums.js';
import type {
  AppId,
  CommentId,
  DocumentId,
  ThreadId,
  UserId,
  VersionId,
  WorkspaceId,
} from './ids.js';

export interface User {
  id: UserId;
  /** Identidad real de la cuenta: sobrevive a que cambien handle o email (RF-104). */
  githubId: number;
  /** Nombre de usuario de GitHub, usado en las menciones (RF-208). */
  handle: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: PlatformRole;
  status: UserStatus;
}

export interface Workspace {
  id: WorkspaceId;
  ownerId: UserId;
  name: string;
  slug: string;
  /** En v1 siempre true; el workspace de equipo es este mismo modelo (RD-5). */
  isPersonal: boolean;
}

export interface WorkspaceMembership {
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
}

export interface App {
  id: AppId;
  workspaceId: WorkspaceId;
  slug: string;
  name: string;
  shortDescription: string | null;
  status: AppStatus;
  accessLevel: AccessLevel;
  /** Quien creó la app; transferible (RF-401, RF-409). */
  precursorId: UserId;
  iconEmoji: string;
  iconColor: string;
  /** Enlace informativo en v1; sin sincronización de datos (RF-417). */
  repoUrl: string | null;
  archivedAt: Date | null;
}

export interface Document {
  id: DocumentId;
  appId: AppId;
  type: DocumentType;
  currentVersionId: VersionId | null;
  currentContent: string;
}

export interface DocumentVersion {
  id: VersionId;
  documentId: DocumentId;
  versionNo: number;
  content: string;
  authorId: UserId;
  message: string | null;
  createdAt: Date;
}

/** Anclaje de un comentario inline, al modelo de anotación del W3C (TRD §9.2). */
export interface InlineAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  anchoredVersionId: VersionId;
  status: AnchorStatus;
}

export interface CommentThread {
  id: ThreadId;
  appId: AppId;
  documentId: DocumentId;
  kind: ThreadKind;
  status: ThreadStatus;
  anchor: InlineAnchor | null;
  createdBy: UserId;
}

export interface Comment {
  id: CommentId;
  threadId: ThreadId;
  parentId: CommentId | null;
  body: string;
  authorId: UserId;
  deletedAt: Date | null;
}
