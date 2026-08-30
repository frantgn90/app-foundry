import { useEffect, useRef, useState } from 'react';

import type { App, Session, Workspace } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { ICON_BACKGROUNDS } from './icon-picker.js';
import { backgroundStyle } from './workspace-background.js';
import { Logo } from './logo.js';
import { StatusPill, VisibilityMark } from './app-status.js';
import { NotificationBell, type NotificationTarget } from './notification-bell.js';
import { UserMenu } from './user-menu.js';
import { Badge } from './ui/badge.js';

/** Qué se está mirando ahora mismo. */
export type Pantalla = 'workspace' | 'admin' | 'account';

interface Props {
  session: Session;
  workspaces: Workspace[];
  current: Workspace | undefined;
  onSelect: (id: string) => void;
  apps: App[];
  currentApp: App | undefined;
  onSelectApp: (id: string) => void;
  onOpenNotification: (destino: NotificationTarget) => void;
  /** Qué se está mirando: el workspace, la administración o la propia cuenta. */
  pantalla: Pantalla;
  onPantalla: (pantalla: Pantalla) => void;
  children: React.ReactNode;
}

/**
 * Cabecera con la ruta actual —plataforma, workspace y app— y el menú de cuenta.
 *
 * Cada tramo de la ruta es además su propio selector, así que moverse no obliga
 * a volver atrás primero. El de workspace marca los ajenos como «Guest», porque
 * lo que puedes hacer cambia por completo entre uno y otro (RF-302, RF-606).
 */
export function Layout({
  session,
  workspaces,
  current,
  onSelect,
  apps,
  currentApp,
  onSelectApp,
  onOpenNotification,
  pantalla,
  onPantalla,
  children,
}: Props) {
  return (
    <div className="min-h-screen">
      {/*
        El fondo del workspace ocupa la página entera, no una tarjeta.
        
        Va fijo y por detrás de todo para que no se desplace al hacer scroll: un
        degradado que sube con el contenido delata el truco y marea. Solo se pinta
        estando en un workspace, porque la administración y los ajustes de la
        cuenta no son de ninguno.
      */}
      {pantalla === 'workspace' && current && (
        <div
          className={cn(
            'pointer-events-none fixed inset-0 -z-10',
            backgroundStyle(current.background),
          )}
          aria-hidden
        />
      )}
      <header className="border-b border-[var(--color-borde)] bg-[var(--color-superficie)]">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-6">
          {/*
            La ruta se lee de un vistazo cuando todos sus tramos pesan lo mismo:
            el nombre de la plataforma va en negrita porque es el origen, no
            porque importe más que dónde estás.
          */}
          <span className="mr-1 flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Logo />
            App Foundry
          </span>

          <Separator />

          <Dropdown
            label={current?.name ?? 'Select a workspace'}
            badge={current && current.role !== 'OWNER' ? <Badge>Guest</Badge> : null}
            options={workspaces.map((w) => ({
              id: w.id,
              label: w.name,
              icon: <IconoCuadro emoji={w.iconEmoji} color={w.iconColor} />,
              badge: w.role !== 'OWNER' ? <Badge>Guest</Badge> : null,
            }))}
            selectedId={current?.id}
            onSelect={onSelect}
            {...(currentApp && current
              ? {
                  onPrimary: () => {
                    onSelect(current.id);
                  },
                }
              : {})}
          />

          {/* El tramo de la app solo existe mientras haya una abierta. */}
          {currentApp && (
            <>
              <Separator />
              <Dropdown
                label={currentApp.name}
                options={apps.map((a) => ({
                  id: a.id,
                  label: a.name,
                  icon: <IconoCuadro emoji={a.icon.emoji} color={a.icon.color} />,
                  badge: a.isArchived ? <Badge>Archived</Badge> : null,
                }))}
                selectedId={currentApp.id}
                onSelect={onSelectApp}
                empty="No other apps here yet"
              />

              {/*
                El estado, la visibilidad y de quién es la app viajan con su
                nombre en la ruta, que es donde ya se está mirando para saber
                dónde se está. Así la ficha no necesita una cabecera propia sólo
                para repetirlo.
              */}
              <StatusPill status={currentApp.isArchived ? 'ARCHIVED' : currentApp.status} />
              <VisibilityMark accessLevel={currentApp.accessLevel} />
              <span className="hidden text-xs text-[var(--color-texto-suave)] sm:inline">
                @{currentApp.precursorHandle}
              </span>
            </>
          )}

          <div className="ml-auto flex items-center gap-3">
            {/*
              Para un administrador, la insignia es también la puerta: es donde
              iría a buscarla, y así la administración no ocupa sitio en la
              cabecera de quien no la tiene (RF-205).
            */}
            {session.platformRole === 'ADMIN' && (
              <button
                onClick={() => {
                  onPantalla(pantalla === 'admin' ? 'workspace' : 'admin');
                }}
                title={pantalla === 'admin' ? 'Back to work' : 'Administration'}
              >
                {pantalla === 'admin' ? <Badge tone="ok">Leave admin</Badge> : <Badge>Admin</Badge>}
              </button>
            )}
            <NotificationBell onOpen={onOpenNotification} />
            <UserMenu
              session={session}
              onSettings={() => {
                onPantalla('account');
              }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}

function Separator() {
  return (
    <span className="text-sm text-[var(--color-texto-suave)]" aria-hidden>
      /
    </span>
  );
}

function IconoCuadro({ emoji, color }: { emoji: string; color: string }) {
  return (
    <span
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded text-[11px]',
        ICON_BACKGROUNDS[color] ?? ICON_BACKGROUNDS['slate'],
      )}
      aria-hidden
    >
      {emoji}
    </span>
  );
}

interface Option {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

/**
 * Un tramo de la ruta que además despliega sus hermanos.
 *
 * Se cierra con Escape y al pulsar fuera: sin eso, abrir el segundo menú dejaba
 * el primero abierto detrás.
 */
function Dropdown({
  label,
  icon,
  badge,
  options,
  selectedId,
  onSelect,
  onPrimary,
  empty,
}: {
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  options: Option[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /**
   * Qué hace pulsar el nombre, si hace algo.
   *
   * Con esto el tramo se parte en dos: el texto lleva a su sitio de un clic y la
   * flecha abre la lista. Sin ello, volver al listado desde una app costaría
   * abrir un menú y elegir en él lo que ya está seleccionado, que es un rodeo
   * para la navegación más frecuente que hay aquí.
   */
  onPrimary?: () => void;
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => {
      if (!caja.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const otras = options.filter((o) => o.id !== selectedId);

  return (
    <div className="relative flex items-center" ref={caja}>
      {onPrimary ? (
        <>
          <button
            onClick={onPrimary}
            className={cn(
              'flex max-w-52 items-center gap-2 rounded-l-lg py-1.5 pl-2 pr-1 text-sm',
              'hover:bg-[var(--color-borde)]/40',
            )}
          >
            {icon}
            <span className="truncate">{label}</span>
            {badge}
          </button>
          <button
            onClick={() => {
              setOpen((v) => !v);
            }}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Switch from ${label}`}
            className="rounded-r-lg py-1.5 pl-0.5 pr-2 hover:bg-[var(--color-borde)]/40"
          >
            <svg viewBox="0 0 12 12" className="size-3 shrink-0 opacity-60" aria-hidden>
              <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </>
      ) : (
        <button
          onClick={() => {
            setOpen((v) => !v);
          }}
          className={cn(
            'flex max-w-52 items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
            'hover:bg-[var(--color-borde)]/40',
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {icon}
          <span className="truncate">{label}</span>
          {badge}
          <svg viewBox="0 0 12 12" className="size-3 shrink-0 opacity-60" aria-hidden>
            <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      )}

      {open && (
        <ul
          role="listbox"
          className={cn(
            'absolute left-0 top-full z-30 mt-1 max-h-80 min-w-56 overflow-y-auto rounded-lg',
            'border border-[var(--color-borde)] bg-[var(--color-superficie)] shadow-lg',
          )}
        >
          {options.length > 0 && otras.length === 0 && empty && (
            <li className="px-3 py-2 text-sm text-[var(--color-texto-suave)]">{empty}</li>
          )}
          {options.map((o) => (
            <li key={o.id}>
              <button
                role="option"
                aria-selected={o.id === selectedId}
                onClick={() => {
                  onSelect(o.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                  'hover:bg-[var(--color-fondo)]',
                  o.id === selectedId && 'font-medium',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                </span>
                {o.badge}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
