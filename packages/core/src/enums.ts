/** Rol en la plataforma (REQUIREMENTS §3.3). */
export const PlatformRole = {
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** Rol dentro de un workspace (REQUIREMENTS §3.4). */
export const WorkspaceRole = {
  OWNER: 'OWNER',
  MEMBER: 'MEMBER',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];

/** Ciclo de vida de una idea (RF-404). */
export const AppStatus = {
  IDEA: 'IDEA',
  DEFINING: 'DEFINING',
  IN_DEVELOPMENT: 'IN_DEVELOPMENT',
  PUBLISHED: 'PUBLISHED',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AppStatus = (typeof AppStatus)[keyof typeof AppStatus];

/** Qué comparte una app dentro de su workspace (RF-405, REQUIREMENTS §3.6). */
export const AccessLevel = {
  PRIVATE: 'PRIVATE',
  WORKSPACE_READ: 'WORKSPACE_READ',
  WORKSPACE_WRITE: 'WORKSPACE_WRITE',
} as const;
export type AccessLevel = (typeof AccessLevel)[keyof typeof AccessLevel];

/** Tipos de documento. En v1 solo se crea VISION (RF-514). */
export const DocumentType = {
  VISION: 'VISION',
  PRD: 'PRD',
  TRD: 'TRD',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const ThreadKind = {
  GENERAL: 'GENERAL',
  INLINE: 'INLINE',
} as const;
export type ThreadKind = (typeof ThreadKind)[keyof typeof ThreadKind];

export const ThreadStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;
export type ThreadStatus = (typeof ThreadStatus)[keyof typeof ThreadStatus];

/** Estado del anclaje de un comentario inline (RF-809). */
export const AnchorStatus = {
  ANCHORED: 'ANCHORED',
  ORPHANED: 'ORPHANED',
} as const;
export type AnchorStatus = (typeof AnchorStatus)[keyof typeof AnchorStatus];

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];
