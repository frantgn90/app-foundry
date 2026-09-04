import { useEffect, useRef, useState } from 'react';

import type { App, Session, Workspace } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { ICON_BACKGROUNDS } from './icon-picker.js';
import { backgroundStyle } from './workspace-background.js';
import { Logo } from './logo.js';
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
 *
 * La ruta dice **dónde estás**, y nada más. El estado de la app, su visibilidad
 * y de quién es viven en la propia ficha, junto a sus etiquetas: son propiedades
 * de la app, no tramos del camino hasta ella, y aquí competían por sitio con lo
 * único que esta barra tiene que dejar claro.
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
          {/* En pantallas estrechas se queda solo el icono: el nombre de la
              plataforma es lo que menos falta hace para saber dónde estás, y
              partido en dos líneas empujaba la cuenta fuera de la pantalla. */}
          <span className="mr-1 flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
            <Logo />
            <span className="hidden sm:inline">App Foundry</span>
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
            </>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
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

/**
 * La flecha del desplegable.
 *
 * Atenuada cuando no hay nada que desplegar: se queda para que el tramo no
 * cambie de forma según cuántas cosas haya —lo que movería el resto de la ruta
 * de sitio—, pero apagada para que se vea que ahí no hay lista.
 */
function Flecha({ atenuada }: { atenuada: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn('size-3 shrink-0', atenuada ? 'opacity-25' : 'opacity-60')}
      aria-hidden
    >
      <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
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
  /*
   * Sin hermanos no hay nada que desplegar, así que la flecha se apaga en vez de
   * abrir una lista que solo contiene lo que ya se está mirando. Es el caso
   * normal de quien tiene un workspace y su primera app.
   */
  const desplegable = otras.length > 0;

  /*
   * Un tramo, dos botones: el nombre lleva a su sitio y la flecha abre la lista.
   * Tienen que **verse como una sola pieza**, porque lo son: al pasar por
   * encima, el grupo entero se tiñe suave y la mitad que está bajo el cursor un
   * poco más. Iluminando solo la mitad tocada, la cápsula parecía partida por la
   * mitad; iluminando las dos por igual, no se sabría cuál se va a pulsar.
   */
  const fondoGrupo = 'group-hover:bg-[var(--color-borde)]/20';
  const fondoPropio = 'hover:bg-[var(--color-borde)]/50';

  return (
    <div className="group relative flex items-center" ref={caja}>
      {onPrimary ? (
        <>
          <button
            onClick={onPrimary}
            className={cn(
              'flex h-8 max-w-32 items-center gap-2 rounded-l-lg pl-2 pr-1 text-sm sm:max-w-52',
              fondoGrupo,
              fondoPropio,
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
            disabled={!desplegable}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Switch from ${label}`}
            className={cn(
              /*
                Alto fijo y el mismo que el del nombre: la flecha solo lleva un
                icono de doce píxeles, así que con relleno vertical le salía una
                caja más baja y las dos mitades de la cápsula no casaban al
                iluminarse.
              */
              'flex h-8 items-center rounded-r-lg pl-0.5 pr-2',
              fondoGrupo,
              desplegable ? fondoPropio : 'cursor-default',
            )}
          >
            <Flecha atenuada={!desplegable} />
          </button>
        </>
      ) : (
        <button
          onClick={() => {
            setOpen((v) => !v);
          }}
          disabled={!desplegable}
          className={cn(
            'flex h-8 max-w-32 items-center gap-2 rounded-lg px-2 text-sm sm:max-w-52',
            desplegable ? fondoPropio : 'cursor-default',
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {icon}
          <span className="truncate">{label}</span>
          {badge}
          <Flecha atenuada={!desplegable} />
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
