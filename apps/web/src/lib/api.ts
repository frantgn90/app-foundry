import { useEffect } from 'react';

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
  openThreads: number;
  updatedAt: string;
}

export interface VisionDocument {
  id: string;
  type: string;
  /** La copia de trabajo, que puede ir por delante de la versión. */
  content: string;
  currentVersionId: string | null;
  versionNo: number;
  /** Lo que hay que devolver al guardar, commitear o descartar (RF-511). */
  revision: number;
  uncommittedChanges: boolean;
  workingAuthors: { handle: string; displayName: string }[];
  canEdit: boolean;
  updatedAt: string;
}

export interface Version {
  id: string;
  versionNo: number;
  coauthorHandles: string[];
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

export interface AppFilters {
  status?: string[];
  tag?: string[];
  accessLevel?: string[];
  archived?: 'hide' | 'only' | 'all';
  sort?: 'updated' | 'name';
  page?: number;
}

export interface AppList {
  items: App[];
  total: number;
  page: number;
  perPage: number;
  availableTags: string[];
}

export function useApps(workspaceId: string | undefined, filtros: AppFilters = {}) {
  const query = {
    ...(filtros.status?.length ? { status: filtros.status.join(',') } : {}),
    ...(filtros.tag?.length ? { tag: filtros.tag.join(',') } : {}),
    ...(filtros.accessLevel?.length ? { accessLevel: filtros.accessLevel.join(',') } : {}),
    ...(filtros.archived ? { archived: filtros.archived } : {}),
    ...(filtros.sort ? { sort: filtros.sort } : {}),
    ...(filtros.page && filtros.page > 1 ? { page: String(filtros.page) } : {}),
  };

  return useQuery<AppList>({
    // Los filtros entran en la clave: cada combinación es una lista distinta y
    // se cachean por separado, así que volver a una anterior es instantáneo.
    queryKey: ['apps', workspaceId, query],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/workspaces/{workspaceId}/apps', {
        params: { path: { workspaceId: workspaceId ?? '' }, query },
      });
      if (error || !data) throw new Error('Could not load apps');
      return data;
    },
  });
}

export interface SearchHit {
  id: string;
  name: string;
  shortDescription: string | null;
  status: string;
  accessLevel: string;
  icon: { emoji: string; color: string };
  isArchived: boolean;
  workspaceId: string;
  workspaceName: string;
  excerpt: string | null;
}

/**
 * Búsqueda global (RF-604).
 *
 * Solo se lanza a partir de dos caracteres: con uno, la consulta devolvería
 * media base de datos y el resultado no ayudaría a nadie.
 */
export function useSearch(termino: string) {
  const q = termino.trim();
  return useQuery<{ items: SearchHit[]; query: string }>({
    queryKey: ['search', q],
    enabled: q.length >= 2,
    // Lo tecleado hace un momento sigue valiendo: evita repetir la consulta al
    // borrar una letra y volver a escribirla.
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/search', { params: { query: { q } } });
      if (error || !data) throw new Error('Could not search');
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
    mutationFn: async (input: { content: string; revision: number }) => {
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

/**
 * Commitear y descartar (RF-505, RF-515).
 *
 * Los dos invalidan lo mismo que guardar y además los hilos: al commitear, los
 * de la versión que se queda atrás salen de la vista, y al descartar vuelven a
 * su sitio los que la edición había dejado huérfanos.
 */
export function useCommitDocument(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { message: string; revision: number }) => {
      const { data, error, response } = await api.POST('/api/v1/apps/{appId}/document/commit', {
        params: { path: { appId } },
        body: input,
      });
      if (response.status === 409) throw new ConflictError(error as unknown as SaveConflict);
      if (error || !data) throw new Error('Could not commit');
      return data as VisionDocument;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['document', appId] });
      await client.invalidateQueries({ queryKey: ['versions', appId] });
      await client.invalidateQueries({ queryKey: ['threads', appId] });
      await client.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

export function useResetDocument(appId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { revision: number }) => {
      const { data, error, response } = await api.POST('/api/v1/apps/{appId}/document/reset', {
        params: { path: { appId } },
        body: input,
      });
      if (response.status === 409) throw new ConflictError(error as unknown as SaveConflict);
      if (error || !data) throw new Error('Could not discard those changes');
      return data as VisionDocument;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['document', appId] });
      await client.invalidateQueries({ queryKey: ['threads', appId] });
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
  /** La versión a la que pertenece; null en los generales (RF-817). */
  versionId: string | null;
  versionNo: number | null;
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

/** Conversaciones vivas que quedaron en otra versión (RF-817). */
export interface OpenElsewhere {
  versionId: string;
  versionNo: number;
  openThreads: number;
}

export interface Threads {
  threads: Thread[];
  openElsewhere: OpenElsewhere[];
}

/**
 * Los hilos de la versión que se está mirando (RF-817).
 *
 * Sin `versionId` son los de la copia de trabajo: los de la versión actual,
 * colocados sobre el texto que se está leyendo. Con él, los de esa versión
 * anclados en su propio texto.
 */
export function useThreads(appId: string, versionId: string | null) {
  return useQuery<Threads>({
    queryKey: ['threads', appId, versionId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/apps/{appId}/threads', {
        params: { path: { appId }, query: versionId ? { versionId } : {} },
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
  /** Sobre qué versión se comenta; solo se admite la actual (RF-817). */
  versionId?: string;
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

export interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  workspaceId: string;
  appId: string | null;
  threadId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
}

export function useNotifications(enabled: boolean) {
  return useQuery<NotificationList>({
    queryKey: ['notifications'],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/notifications');
      if (error || !data) throw new Error('Could not load notifications');
      return data;
    },
  });
}

/**
 * Escucha el canal de avisos y refresca la lista cuando llega algo.
 *
 * Se refresca en vez de insertar el evento en la caché a propósito: el evento
 * trae lo justo para saber que hay algo nuevo, y volver a pedir la lista deja un
 * solo sitio donde se decide qué se ve y en qué orden. Es una petición más por
 * aviso, que a este ritmo no es nada.
 *
 * `EventSource` reconecta solo y recuerda el último identificador recibido, así
 * que la reanudación del servidor funciona sin escribir nada aquí.
 */
export function useNotificationStream(enabled: boolean) {
  const client = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource('/api/v1/notifications/stream');
    source.addEventListener('notification', () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
    });

    return () => {
      source.close();
    };
  }, [enabled, client]);
}

export function useMarkNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const { data, error } = await api.POST('/api/v1/notifications/read', {
        body: ids ? { ids } : {},
      });
      if (error || !data) throw new Error('Could not mark as read');
      return data;
    },
    onSuccess: (data) => {
      client.setQueryData(['notifications'], data);
    },
  });
}

export function usePurgeNotifications() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const { data, error } = await api.DELETE('/api/v1/notifications', {
        body: ids ? { ids } : {},
      });
      if (error || !data) throw new Error('Could not clear notifications');
      return data;
    },
    onSuccess: (data) => {
      client.setQueryData(['notifications'], data);
    },
  });
}

export interface AdminUser {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  platformRole: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  workspaceCount: number;
  isMe: boolean;
}

export interface AuditEntry {
  id: string;
  actorHandle: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function useAdminUsers(enabled: boolean) {
  return useQuery<AdminUser[]>({
    queryKey: ['admin', 'users'],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/admin/users');
      if (error || !data) throw new Error('Could not load accounts');
      return data;
    },
  });
}

export function useUpdateAdminUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      platformRole?: 'ADMIN' | 'MEMBER';
      status?: 'ACTIVE' | 'DEACTIVATED';
    }) => {
      const { id, ...cambios } = vars;
      const { data, error } = await api.PATCH('/api/v1/admin/users/{id}', {
        params: { path: { id } },
        body: cambios,
      });
      if (error || !data) throw new Error('Could not update the account');
      return data;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useInstanceMetrics(enabled: boolean) {
  return useQuery<Record<string, number>>({
    queryKey: ['admin', 'metrics'],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/admin/metrics');
      if (error || !data) throw new Error('Could not load metrics');
      return data;
    },
  });
}

export function usePlatformAudit(enabled: boolean) {
  return useQuery<AuditEntry[]>({
    queryKey: ['admin', 'audit'],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/admin/audit', { params: { query: {} } });
      if (error || !data) throw new Error('Could not load the audit log');
      return data;
    },
  });
}

export function useWorkspaceAudit(workspaceId: string, enabled: boolean) {
  return useQuery<AuditEntry[]>({
    queryKey: ['workspace-audit', workspaceId],
    enabled,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/audit', {
        params: { path: { id: workspaceId } },
      });
      if (error || !data) throw new Error('Could not load the activity');
      return data;
    },
  });
}

/**
 * Baja voluntaria de la propia cuenta (RF-207).
 *
 * No borra nada: apaga la cuenta y deja sus apps en el periodo de gracia. Al
 * terminar se recarga la página entera en vez de limpiar el estado a mano —ya
 * no hay sesión que sostenga nada, y así se aterriza en la pantalla de entrada
 * sin dejar rastros de la anterior en memoria.
 */
export function useDeactivateAccount() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/v1/auth/me');
      if (error) throw new Error('Could not deactivate the account');
    },
    onSuccess: () => {
      window.location.href = '/';
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Inteligencia artificial (v2)                                               */
/* -------------------------------------------------------------------------- */

export type AiProviderId = 'ANTHROPIC' | 'GROQ';

export interface AiProvider {
  provider: AiProviderId;
  status: 'ACTIVE' | 'DISABLED' | 'INVALID';
  capabilities: {
    streaming: boolean;
    schemaOutput: boolean;
    webSearch: boolean;
    exactTokenCount: boolean;
  };
  credentialHint?: string;
  monthlyTokenQuota?: number | null;
  quotaAlertPct?: number;
  verifiedAt?: string | null;
}

export interface AiSettings {
  enabled: boolean;
  consent: { accepted: boolean; acceptedAt: string | null; acceptedBy: string | null };
}

export interface AiModel {
  provider: AiProviderId;
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  available: boolean;
}

export type AiTaskId = 'IDEA_GENERATION' | 'TEXT_ASSIST' | 'AGENT_REVIEW' | 'AGENT_REPLY';

export interface AiTaskAssignment {
  task: AiTaskId;
  provider: AiProviderId | null;
  modelId: string | null;
  supported: boolean;
  modelAvailable: boolean;
  missing: string[];
  degraded: string[];
}

export interface AiUsage {
  month: string;
  providers: {
    provider: AiProviderId;
    quota: number | null;
    spentTokens: number;
    reservedTokens: number;
  }[];
  byTask: { key: string; inputTokens: number; outputTokens: number; invocations: number }[];
  byModel: { key: string; inputTokens: number; outputTokens: number; invocations: number }[];
  byMember: { key: string; inputTokens: number; outputTokens: number; invocations: number }[];
}

/** Todo lo de IA de un workspace se invalida junto: son cuatro vistas del mismo estado. */
function invalidarIa(client: ReturnType<typeof useQueryClient>, workspaceId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['ia-proveedores', workspaceId] }),
    client.invalidateQueries({ queryKey: ['ia-ajustes', workspaceId] }),
    client.invalidateQueries({ queryKey: ['ia-modelos', workspaceId] }),
    client.invalidateQueries({ queryKey: ['ia-tareas', workspaceId] }),
    client.invalidateQueries({ queryKey: ['ia-consumo', workspaceId] }),
  ]);
}

export function useAiSettings(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ia-ajustes', workspaceId],
    enabled,
    queryFn: async (): Promise<AiSettings> => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/ai', {
        params: { path: { id: workspaceId } },
      });
      if (error || !data) throw new Error('Could not load the AI settings');
      return data;
    },
  });
}

export function useAiProviders(workspaceId: string) {
  return useQuery({
    queryKey: ['ia-proveedores', workspaceId],
    queryFn: async (): Promise<AiProvider[]> => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/ai/providers', {
        params: { path: { id: workspaceId } },
      });
      if (error || !data) throw new Error('Could not load the AI providers');
      return data as AiProvider[];
    },
  });
}

export function useAcceptAiConsent(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/v1/workspaces/{id}/ai/consent', {
        params: { path: { id: workspaceId } },
      });
      if (error) throw new Error('Could not record the acceptance');
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useSetAiEnabled(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await api.PATCH('/api/v1/workspaces/{id}/ai', {
        params: { path: { id: workspaceId } },
        body: { enabled },
      });
      if (error) throw new Error('Could not change the switch');
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

/**
 * Guarda la credencial de un proveedor.
 *
 * El mensaje del servidor se propaga tal cual: distingue «el proveedor ha
 * rechazado la clave» de «el proveedor no responde», y esa diferencia decide si
 * hay que generar otra clave o simplemente esperar.
 */
export function useConfigureProvider(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, apiKey }: { provider: AiProviderId; apiKey: string }) => {
      const { error } = await api.PUT('/api/v1/workspaces/{id}/ai/providers/{provider}', {
        params: { path: { id: workspaceId, provider } },
        body: { apiKey },
      });
      if (error) throw new Error(mensajeDeError(error, 'Could not save the credential'));
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useVerifyProvider(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (provider: AiProviderId) => {
      const { error } = await api.POST('/api/v1/workspaces/{id}/ai/providers/{provider}/verify', {
        params: { path: { id: workspaceId, provider } },
      });
      if (error) throw new Error(mensajeDeError(error, 'Could not verify the credential'));
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useSetProviderStatus(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      provider,
      status,
    }: {
      provider: AiProviderId;
      status: 'ACTIVE' | 'DISABLED';
    }) => {
      const { error } = await api.PATCH('/api/v1/workspaces/{id}/ai/providers/{provider}', {
        params: { path: { id: workspaceId, provider } },
        body: { status },
      });
      if (error) throw new Error(mensajeDeError(error, 'Could not change the provider'));
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useRemoveProvider(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (provider: AiProviderId) => {
      const { error } = await api.DELETE('/api/v1/workspaces/{id}/ai/providers/{provider}', {
        params: { path: { id: workspaceId, provider } },
      });
      if (error) throw new Error('Could not remove the provider');
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useSetProviderQuota(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      provider,
      monthlyTokenQuota,
      quotaAlertPct,
    }: {
      provider: AiProviderId;
      monthlyTokenQuota: number | null;
      quotaAlertPct?: number;
    }) => {
      const { error } = await api.PUT('/api/v1/workspaces/{id}/ai/providers/{provider}/quota', {
        params: { path: { id: workspaceId, provider } },
        body: {
          ...(monthlyTokenQuota !== null && { monthlyTokenQuota }),
          ...(quotaAlertPct !== undefined && { quotaAlertPct }),
        },
      });
      if (error) throw new Error('Could not save the quota');
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useAiModels(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ia-modelos', workspaceId],
    enabled,
    queryFn: async (): Promise<AiModel[]> => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/ai/models', {
        params: { path: { id: workspaceId } },
      });
      if (error || !data) throw new Error('Could not load the model catalogue');
      return data;
    },
  });
}

export function useAiTasks(workspaceId: string) {
  return useQuery({
    queryKey: ['ia-tareas', workspaceId],
    queryFn: async (): Promise<AiTaskAssignment[]> => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/ai/tasks', {
        params: { path: { id: workspaceId } },
      });
      if (error || !data) throw new Error('Could not load the task assignments');
      return data;
    },
  });
}

export function useAssignTaskModel(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      task,
      provider,
      modelId,
    }: {
      task: AiTaskId;
      provider: AiProviderId;
      modelId: string;
    }) => {
      const { error } = await api.PUT('/api/v1/workspaces/{id}/ai/tasks/{task}', {
        params: { path: { id: workspaceId, task } },
        body: { provider, modelId },
      });
      if (error) throw new Error(mensajeDeError(error, 'Could not assign the model'));
    },
    onSuccess: () => invalidarIa(client, workspaceId),
  });
}

export function useAiUsage(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ia-consumo', workspaceId],
    enabled,
    queryFn: async (): Promise<AiUsage> => {
      const { data, error } = await api.GET('/api/v1/workspaces/{id}/ai/usage', {
        params: { path: { id: workspaceId } },
      });
      if (error || !data) throw new Error('Could not load this month usage');
      return data;
    },
  });
}

/**
 * El motivo que da el servidor, cuando lo da.
 *
 * Importa más de lo que parece: «el proveedor ha rechazado la credencial» y «el
 * proveedor no responde» piden cosas distintas de quien lo lee, y un mensaje
 * genérico llevaría a regenerar una clave que estaba bien.
 */
function mensajeDeError(error: unknown, porDefecto: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const mensaje = error.message;
    if (typeof mensaje === 'string') return mensaje;
    if (Array.isArray(mensaje) && typeof mensaje[0] === 'string') return mensaje[0];
  }
  return porDefecto;
}
