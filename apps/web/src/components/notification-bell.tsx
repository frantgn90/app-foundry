import { useEffect, useRef, useState } from 'react';

import {
  type Notification,
  useMarkNotificationsRead,
  useNotifications,
  useNotificationStream,
  usePurgeNotifications,
} from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { Button } from './ui/button.js';

export interface NotificationTarget {
  workspaceId: string;
  appId: string | null;
  threadId: string | null;
}

/**
 * La campana y su panel (RF-901).
 *
 * El contador va siempre visible, que es lo que convierte esto en algo que se
 * mira: un centro de avisos escondido no se abre nunca y da igual lo que tenga
 * dentro.
 */
export function NotificationBell({ onOpen }: { onOpen: (destino: NotificationTarget) => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const avisos = useNotifications(true);
  useNotificationStream(true);
  const marcar = useMarkNotificationsRead();
  const purgar = usePurgeNotifications();

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  const sinLeer = avisos.data?.unread ?? 0;
  const items = avisos.data?.items ?? [];
  const leidos = items.filter((n) => n.readAt !== null).length;

  return (
    <div className="relative" ref={caja}>
      <button
        onClick={() => {
          setAbierto((v) => !v);
        }}
        className={cn(
          'relative grid size-8 place-items-center rounded-lg',
          'hover:bg-[var(--color-borde)]/40',
        )}
        aria-label={sinLeer > 0 ? `${String(sinLeer)} unread notifications` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={abierto}
      >
        <svg viewBox="0 0 20 20" className="size-4.5" aria-hidden>
          <path
            d="M10 3a4 4 0 0 0-4 4v3l-1.5 2.5h11L14 10V7a4 4 0 0 0-4-4Zm0 13a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {sinLeer > 0 && (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full px-1',
              'bg-[var(--color-acento)] text-[10px] font-medium text-white',
            )}
          >
            {sinLeer > 99 ? '99+' : sinLeer}
          </span>
        )}
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={cn(
            'absolute right-0 top-full z-30 mt-1 flex max-h-[26rem] w-80 flex-col rounded-lg',
            'border border-[var(--color-borde)] bg-[var(--color-superficie)] shadow-lg',
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-[var(--color-borde)] px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            <span className="flex gap-1">
              {sinLeer > 0 && (
                <Button
                  variant="ghost"
                  className="px-1.5 py-0.5 text-xs"
                  onClick={() => {
                    marcar.mutate(undefined);
                  }}
                >
                  Mark all read
                </Button>
              )}
              {leidos > 0 && (
                <Button
                  variant="ghost"
                  className="px-1.5 py-0.5 text-xs"
                  onClick={() => {
                    purgar.mutate(undefined);
                  }}
                >
                  Clear read
                </Button>
              )}
            </span>
          </header>

          <ul className="flex-1 overflow-y-auto">
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-[var(--color-texto-suave)]">
                Nothing yet. You&apos;ll hear about comments and mentions here.
              </li>
            )}
            {items.map((aviso) => (
              <li key={aviso.id}>
                <button
                  onClick={() => {
                    // Se marca al abrirlo: si has ido a mirarlo, ya está visto.
                    if (aviso.readAt === null) marcar.mutate([aviso.id]);
                    setAbierto(false);
                    onOpen({
                      workspaceId: aviso.workspaceId,
                      appId: aviso.appId,
                      threadId: aviso.threadId,
                    });
                  }}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-[var(--color-borde)] px-3 py-2 text-left',
                    'last:border-b-0 hover:bg-[var(--color-fondo)]',
                    aviso.readAt === null && 'bg-[var(--color-acento)]/5',
                  )}
                >
                  <span className="flex items-baseline gap-1.5">
                    {aviso.readAt === null && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-[var(--color-acento)]"
                        aria-hidden
                      />
                    )}
                    <span className="text-sm">{titulo(aviso)}</span>
                  </span>
                  {extracto(aviso) && (
                    <span className="line-clamp-2 pl-3 text-xs text-[var(--color-texto-suave)]">
                      {extracto(aviso)}
                    </span>
                  )}
                  <span className="pl-3 text-xs text-[var(--color-texto-suave)]">
                    {cuando(aviso.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function texto(aviso: Notification, clave: string): string {
  const valor = aviso.payload[clave];
  return typeof valor === 'string' ? valor : '';
}

/**
 * Cómo se lee cada aviso.
 *
 * Se redacta a partir del `payload` guardado y no de consultas nuevas: por eso
 * un aviso sobre un comentario que después se borró sigue siendo legible.
 */
function titulo(aviso: Notification): string {
  const quien = texto(aviso, 'actorHandle');
  const app = texto(aviso, 'appName');

  switch (aviso.type) {
    case 'WORKSPACE_INVITED':
      return `@${quien} invited you to ${texto(aviso, 'workspaceName')}`;
    case 'APP_COMMENTED':
      return `@${quien} commented on ${app}`;
    case 'THREAD_REPLIED':
      return `@${quien} replied in ${app}`;
    case 'THREAD_RESOLVED':
      return `@${quien} resolved your thread in ${app}`;
    case 'MENTIONED':
      return `@${quien} mentioned you in ${app}`;
    case 'DOCUMENT_VERSION_SAVED':
      return `@${quien} saved a new version of ${app}`;
    case 'PRECURSOR_TRANSFERRED':
      return `@${quien} made you the precursor of ${app}`;
    case 'APPS_INHERITED':
      return `You inherited apps in this workspace`;
    case 'AI_MODEL_UNAVAILABLE':
      return `${texto(aviso, 'provider')} retired ${texto(aviso, 'modelId')}, still assigned to ${texto(aviso, 'task')}`;
    default:
      return `Something happened in ${app}`;
  }
}

function extracto(aviso: Notification): string {
  return texto(aviso, 'excerpt') || texto(aviso, 'message');
}

/** Tiempo relativo, que es como se lee una lista de avisos: por lo reciente. */
function cuando(iso: string): string {
  const segundos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (segundos < 60) return 'just now';
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${String(minutos)}m ago`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `${String(horas)}h ago`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return `${String(dias)}d ago`;
  return new Date(iso).toLocaleDateString();
}
