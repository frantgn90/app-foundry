import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { type components, createApiClient } from '@app-foundry/contracts';

/**
 * Cliente derivado del OpenAPI que publica el servidor.
 *
 * Va contra el mismo origen: en desarrollo el proxy de Vite reenvía `/api` a la
 * API, de modo que la cookie de sesión se comporta igual que lo hará en
 * producción, sin sorpresas al desplegar.
 */
export const api = createApiClient();

export interface Session {
  id: string;
  handle: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: 'ADMIN' | 'MEMBER';
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  iconEmoji: string;
  iconColor: string;
  background: string;
  role: 'OWNER' | 'MEMBER';
}

export type WorkspaceUpdate = components['schemas']['UpdateWorkspaceDto'];

export interface Member {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'MEMBER';
}

export interface Invitation {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

/**
 * Quién soy, o `null` si no hay sesión.
 *
 * Un 401 no es un error que reintentar: es la respuesta correcta cuando nadie
 * ha entrado todavía. Devolverlo como `null` deja que la aplicación distinga
 * «no has entrado» de «algo se ha roto», que son cosas muy distintas de contar.
 */
export function useSession() {
  return useQuery<Session | null>({
    queryKey: ['sesion'],
    queryFn: async () => {
      const { data, response } = await api.GET('/api/v1/auth/me');
      if (response.status === 401) return null;
      if (!data) throw new Error('No se pudo consultar la sesión');
      return data;
    },
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Workspaces del usuario.
 *
 * Se desactiva hasta que hay sesión: sin ella la petición fallaría con un 401
 * garantizado, y un error esperado en la consola es ruido que confunde cuando
 * se busca uno de verdad.
 */
export function useWorkspaces(enabled: boolean) {
  return useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/workspaces');
      if (error || !data) throw new Error('No se pudieron cargar los workspaces');
      return data;
    },
  });
}

export function useMembers(workspaceId: string | undefined) {
  return useQuery<Member[]>({
    queryKey: ['miembros', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/members', {
        params: { path: { id: workspaceId ?? '' } },
      });
      if (error || !data) throw new Error('No se pudieron cargar los miembros');
      return data;
    },
  });
}

/** Solo el dueño puede consultarlas, así que un fallo aquí no es excepcional. */
export function useInvitations(workspaceId: string | undefined, enabled: boolean) {
  return useQuery<Invitation[]>({
    queryKey: ['invitaciones', workspaceId],
    enabled: Boolean(workspaceId) && enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId ?? '' } },
      });
      if (error || !data) throw new Error('No se pudieron cargar las invitaciones');
      return data;
    },
  });
}

export function useInvite(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await api.POST('/api/v1/workspaces/{id}/invitations', {
        params: { path: { id: workspaceId } },
        body: { email },
      });
      if (error || !data) throw new Error('No se pudo enviar la invitación');
      return data;
    },
    onSuccess: async () => {
      // Se refrescan las dos listas: si esa persona ya tenía cuenta, acaba de
      // convertirse en miembro.
      await client.invalidateQueries({ queryKey: ['invitaciones', workspaceId] });
      await client.invalidateQueries({ queryKey: ['miembros', workspaceId] });
    },
  });
}

export function useRevokeInvitation(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await api.DELETE('/api/v1/workspaces/invitations/{invitationId}', {
        params: { path: { invitationId } },
      });
      if (error) throw new Error('No se pudo revocar la invitación');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['invitaciones', workspaceId] }),
  });
}

export function useRemoveMember(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE('/api/v1/workspaces/{id}/members/{userId}', {
        params: { path: { id: workspaceId, userId } },
      });
      if (error) throw new Error('No se pudo expulsar a esta persona');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['miembros', workspaceId] }),
  });
}

export function useLeaveWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const { error } = await api.POST('/api/v1/workspaces/{id}/leave', {
        params: { path: { id: workspaceId } },
      });
      if (error) throw new Error('No se pudo abandonar el workspace');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changes: WorkspaceUpdate) => {
      const { data, error } = await api.PATCH('/api/v1/workspaces/{id}', {
        params: { path: { id: workspaceId } },
        body: changes,
      });
      if (error || !data) throw new Error('Could not save the changes');
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}

export function useSignOut() {
  return useMutation({
    mutationFn: async () => {
      await api.POST('/api/v1/auth/logout');
      // Recarga completa: así no queda ningún dato del usuario anterior en la
      // caché de consultas.
      window.location.href = '/';
    },
  });
}

export interface App {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  status: string;
  accessLevel: string;
  icon: { emoji: string; color: string };
  tags: string[];
  repoUrl: string | null;
  precursorHandle: string;
  isPrecursor: boolean;
  canEdit: boolean;
  isArchived: boolean;
  updatedAt: string;
}

export interface VisionDocument {
  id: string;
  type: string;
  content: string;
  currentVersionId: string | null;
  versionNo: number;
  canEdit: boolean;
  updatedAt: string;
}

export interface Version {
  id: string;
  versionNo: number;
  authorHandle: string;
  authorDisplayName: string;
  message: string | null;
  createdAt: string;
}

/** Lo que devuelve la API cuando alguien guardó mientras editabas (RF-511). */
export interface SaveConflict {
  message: string;
  currentContent: string;
  currentVersionId: string;
  currentVersionNo: number;
  lastAuthorHandle: string;
}

export class ConflictError extends Error {
  constructor(readonly detail: SaveConflict) {
    super(detail.message);
    this.name = 'ConflictError';
  }
}

export function useApps(workspaceId: string | undefined) {
  return useQuery<App[]>({
    queryKey: ['apps', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/workspaces/{workspaceId}/apps', {
        params: { path: { workspaceId: workspaceId ?? '' } },
      });
      if (error || !data) throw new Error('Could not load apps');
      return data;
    },
  });
}

export function useCreateApp(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST('/api/v1/workspaces/{workspaceId}/apps', {
        params: { path: { workspaceId } },
        body: { name },
      });
      if (error || !data) throw new Error('Could not create the app');
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['apps', workspaceId] }),
  });
}

export function useApp(appId: string) {
  return useQuery<App>({
    queryKey: ['app', appId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{id}', {
        params: { path: { id: appId } },
      });
      if (error || !data) throw new Error('Could not load the app');
      return data;
    },
  });
}

export function useDocument(appId: string) {
  return useQuery<VisionDocument>({
    queryKey: ['document', appId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{appId}/document', {
        params: { path: { appId } },
      });
      if (error || !data) throw new Error('Could not load the document');
      return data as VisionDocument;
    },
  });
}

export function useSaveDocument(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { content: string; baseVersionId: string; message?: string }) => {
      const { data, error, response } = await api.PUT('/api/v1/apps/{appId}/document', {
        params: { path: { appId } },
        body: input,
      });
      // El 409 no es un fallo cualquiera: trae consigo lo que hay guardado
      // ahora, y la interfaz necesita ese contenido para poder enseñar el
      // conflicto en lugar de limitarse a decir que algo salió mal.
      if (response.status === 409) {
        throw new ConflictError(error as unknown as SaveConflict);
      }
      if (error || !data) throw new Error('Could not save');
      return data as VisionDocument;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['document', appId] });
      await client.invalidateQueries({ queryKey: ['versions', appId] });
      await client.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useVersions(appId: string) {
  return useQuery<Version[]>({
    queryKey: ['versions', appId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{appId}/document/versions', {
        params: { path: { appId } },
      });
      if (error || !data) throw new Error('Could not load history');
      return data;
    },
  });
}

export function useVersionContent(appId: string, versionId: string | null) {
  return useQuery<{ content: string; versionNo: number }>({
    queryKey: ['version', appId, versionId],
    enabled: Boolean(versionId),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{appId}/document/versions/{versionId}', {
        params: { path: { appId, versionId: versionId ?? '' } },
      });
      if (error || !data) throw new Error('Could not load that version');
      return data;
    },
  });
}

export function useRestoreVersion(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await api.POST('/api/v1/apps/{appId}/document/restore/{versionId}', {
        params: { path: { appId, versionId } },
      });
      if (error || !data) throw new Error('Could not restore that version');
      return data as VisionDocument;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['document', appId] });
      await client.invalidateQueries({ queryKey: ['versions', appId] });
    },
  });
}

/**
 * Cambios admitidos sobre una app.
 *
 * Se deriva del contrato en lugar de escribirse a mano: así el editor conoce la
 * lista exacta de emojis y estados válidos, y un cambio en el servidor rompe la
 * compilación aquí, que es cuando conviene enterarse.
 */
export type AppUpdate = components['schemas']['UpdateAppDto'];
export type AccessLevel = components['schemas']['ChangeAccessLevelDto']['accessLevel'];

export function useUpdateApp(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changes: AppUpdate) => {
      const { data, error } = await api.PATCH('/api/v1/apps/{id}', {
        params: { path: { id: appId } },
        body: changes,
      });
      if (error || !data) throw new Error('Could not save the changes');
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['app', appId] });
      await client.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useChangeAccessLevel(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accessLevel: AccessLevel) => {
      const { data, error } = await api.PATCH('/api/v1/apps/{id}/access-level', {
        params: { path: { id: appId } },
        body: { accessLevel },
      });
      if (error || !data) throw new Error('Could not change who can see this');
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['app', appId] });
      await client.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useSetArchived(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (archived: boolean) => {
      const path = archived ? '/api/v1/apps/{id}/archive' : '/api/v1/apps/{id}/unarchive';
      const { data, error } = await api.POST(path, { params: { path: { id: appId } } });
      if (error || !data) throw new Error('Could not archive this app');
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['app', appId] });
      await client.invalidateQueries({ queryKey: ['apps'] });
      await client.invalidateQueries({ queryKey: ['document', appId] });
    },
  });
}

export function useDeleteApp(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/v1/apps/{id}', {
        params: { path: { id: appId } },
      });
      if (error) throw new Error('Could not delete this app');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['apps'] }),
  });
}

export function useTransferPrecursor(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await api.POST('/api/v1/apps/{id}/transfer-precursor', {
        params: { path: { id: appId } },
        body: { userId },
      });
      if (error || !data) throw new Error('Could not transfer this app');
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['app', appId] });
      await client.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export interface Comment {
  id: string;
  parentId: string | null;
  body: string;
  authorHandle: string;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  isMine: boolean;
  isDeleted: boolean;
  isEdited: boolean;
  mentions: string[];
  createdAt: string;
}

export interface Thread {
  id: string;
  kind: 'GENERAL' | 'INLINE';
  status: 'OPEN' | 'RESOLVED';
  anchorStatus: 'ANCHORED' | 'ORPHANED' | null;
  anchorQuote: string | null;
  anchorStart: number | null;
  anchorEnd: number | null;
  resolvedByHandle: string | null;
  canDelete: boolean;
  comments: Comment[];
  createdAt: string;
}

export interface MentionableUser {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export function useThreads(appId: string) {
  return useQuery<Thread[]>({
    queryKey: ['threads', appId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{appId}/threads', {
        params: { path: { appId } },
      });
      if (error || !data) throw new Error('Could not load comments');
      return data;
    },
  });
}

export function useMentionable(appId: string) {
  return useQuery<MentionableUser[]>({
    queryKey: ['mentionable', appId],
    // La lista es corta y cambia poco: se filtra en el cliente al escribir.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{appId}/mentionable', {
        params: { path: { appId } },
      });
      if (error || !data) throw new Error('Could not load people');
      return data;
    },
  });
}

interface NewThread {
  body: string;
  quote?: string;
  start?: number;
  end?: number;
}

export function useCreateThread(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewThread) => {
      const { data, error } = await api.POST('/api/v1/apps/{appId}/threads', {
        params: { path: { appId } },
        body: input,
      });
      if (error || !data) throw new Error('Could not post that comment');
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['threads', appId] }),
  });
}

export function useReply(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; body: string; parentId?: string }) => {
      const { data, error } = await api.POST('/api/v1/threads/{threadId}/comments', {
        params: { path: { threadId: input.threadId } },
        body: { body: input.body, ...(input.parentId ? { parentId: input.parentId } : {}) },
      });
      if (error || !data) throw new Error('Could not post that reply');
      return data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['threads', appId] }),
  });
}

export function useResolveThread(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; resolved: boolean }) => {
      const path = input.resolved
        ? '/api/v1/threads/{threadId}/resolve'
        : '/api/v1/threads/{threadId}/reopen';
      const { error } = await api.POST(path, { params: { path: { threadId: input.threadId } } });
      if (error) throw new Error('Could not change that thread');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['threads', appId] }),
  });
}

export function useDeleteThread(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await api.DELETE('/api/v1/threads/{threadId}', {
        params: { path: { threadId } },
      });
      if (error) throw new Error('Could not delete that thread');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['threads', appId] }),
  });
}

export function useDeleteComment(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await api.DELETE('/api/v1/comments/{commentId}', {
        params: { path: { commentId } },
      });
      if (error) throw new Error('Could not delete that comment');
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['threads', appId] }),
  });
}
