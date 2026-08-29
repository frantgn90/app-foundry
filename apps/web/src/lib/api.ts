import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createApiClient } from '@app-foundry/contracts';

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
  role: 'OWNER' | 'MEMBER';
}

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
  const cliente = useQueryClient();
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
      await cliente.invalidateQueries({ queryKey: ['invitaciones', workspaceId] });
      await cliente.invalidateQueries({ queryKey: ['miembros', workspaceId] });
    },
  });
}

export function useRevokeInvitation(workspaceId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await api.DELETE('/api/v1/workspaces/invitations/{invitationId}', {
        params: { path: { invitationId } },
      });
      if (error) throw new Error('No se pudo revocar la invitación');
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['invitaciones', workspaceId] }),
  });
}

export function useRemoveMember(workspaceId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.DELETE('/api/v1/workspaces/{id}/members/{userId}', {
        params: { path: { id: workspaceId, userId } },
      });
      if (error) throw new Error('No se pudo expulsar a esta persona');
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['miembros', workspaceId] }),
  });
}

export function useLeaveWorkspace() {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const { error } = await api.POST('/api/v1/workspaces/{id}/leave', {
        params: { path: { id: workspaceId } },
      });
      if (error) throw new Error('No se pudo abandonar el workspace');
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}

export function useRenameWorkspace(workspaceId: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await api.PATCH('/api/v1/workspaces/{id}', {
        params: { path: { id: workspaceId } },
        body: { name },
      });
      if (error) throw new Error('No se pudo renombrar el workspace');
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ['workspaces'] }),
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
