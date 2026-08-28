import {
  AccessLevel,
  type App,
  type Actor,
  AppStatus,
  asAppId,
  asUserId,
  asWorkspaceId,
  PlatformRole,
  UserStatus,
  type WorkspaceMembership,
  WorkspaceRole,
} from '../src/index.js';

export const OWNER = asUserId('00000000-0000-7000-8000-000000000001');
export const GUEST = asUserId('00000000-0000-7000-8000-000000000002');
export const STRANGER = asUserId('00000000-0000-7000-8000-000000000003');
export const WORKSPACE = asWorkspaceId('00000000-0000-7000-8000-0000000000a1');

export function actor(id = OWNER, overrides: Partial<Actor> = {}): Actor {
  return {
    id,
    platformRole: PlatformRole.MEMBER,
    status: UserStatus.ACTIVE,
    ...overrides,
  };
}

export function membership(
  userId = OWNER,
  role: WorkspaceRole = WorkspaceRole.OWNER,
): WorkspaceMembership {
  return { workspaceId: WORKSPACE, userId, role };
}

export function app(overrides: Partial<App> = {}): App {
  return {
    id: asAppId('00000000-0000-7000-8000-0000000000f1'),
    workspaceId: WORKSPACE,
    slug: 'una-idea',
    name: 'Una idea',
    shortDescription: null,
    status: AppStatus.IDEA,
    accessLevel: AccessLevel.PRIVATE,
    precursorId: OWNER,
    iconEmoji: '💡',
    iconColor: 'amber',
    repoUrl: null,
    archivedAt: null,
    ...overrides,
  };
}
