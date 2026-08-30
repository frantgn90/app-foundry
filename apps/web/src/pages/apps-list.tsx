import { type FormEvent, useEffect, useState } from 'react';

import { type App, type AppFilters, useApps, useCreateApp, type Workspace } from '../lib/api.js';
import { AppFiltersBar } from '../components/app-filters.js';
import { StatusPill, TagList, VisibilityMark } from '../components/app-status.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { ICON_BACKGROUNDS } from '../components/icon-picker.js';
import { backgroundStyle } from '../components/workspace-background.js';
import { cn } from '../lib/utils.js';

export function AppsListPage({
  workspace,
  filtros,
  crearAhora,
  onFiltros,
  onOpen,
}: {
  workspace: Workspace;
  filtros: AppFilters;
  /** Cambia cuando el atajo pide una app nueva; su valor da igual. */
  crearAhora: number;
  onFiltros: (siguiente: AppFilters) => void;
  onOpen: (appId: string) => void;
}) {
  const apps = useApps(workspace.id, filtros);
  const create = useCreateApp(workspace.id);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  // El atajo abre el formulario aquí, que es donde vive.
  useEffect(() => {
    if (crearAhora > 0) setCreating(true);
  }, [crearAhora]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(name.trim(), {
      onSuccess: (app) => {
        setName('');
        setCreating(false);
        // Se entra directamente a escribir: crear una app y quedarse mirando
        // la lista sería dejar el trabajo a medias.
        onOpen(app.id);
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* La cabecera lleva el aspecto del workspace: es lo que hace que dos
          espacios distintos se distingan de un vistazo al cambiar entre ellos. */}
      <header
        className={cn(
          'flex items-start justify-between gap-4 rounded-xl p-5',
          backgroundStyle(workspace.background),
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-xl text-xl',
              ICON_BACKGROUNDS[workspace.iconColor] ?? ICON_BACKGROUNDS['slate'],
            )}
            aria-hidden
          >
            {workspace.iconEmoji}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
            <p className="text-sm text-[var(--color-texto-suave)]">
              {apps.data?.total
                ? `${String(apps.data.total)} idea${apps.data.total === 1 ? '' : 's'} here`
                : 'No ideas here yet'}
            </p>
          </div>
        </div>
        {!creating && (
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            New app
          </Button>
        )}
      </header>

      {creating && (
        <Card className="p-4">
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="app-name">
              What&apos;s the idea called?
            </label>
            <div className="flex gap-2">
              <Input
                id="app-name"
                autoFocus
                required
                placeholder="Reading Companion"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCreating(false);
                  setName('');
                }}
              >
                Cancel
              </Button>
            </div>
            {workspace.role === 'OWNER' ? (
              <p className="text-xs text-[var(--color-texto-suave)]">
                You can rename it later. What matters now is writing the vision.
              </p>
            ) : (
              /*
               * En un workspace ajeno lo que crees es del workspace: visible y
               * editable por todos, y no puedes hacerlo privado (RF-606).
               *
               * Se dice aquí, antes de escribir, y no al descubrirlo después:
               * quien iba a apuntar algo personal tiene que poder cambiar de
               * idea mientras todavía es gratis.
               */
              <p className="flex items-start gap-1.5 text-xs text-[var(--color-texto-suave)]">
                <span aria-hidden>ℹ</span>
                <span>
                  You&apos;re a guest in <strong>{workspace.name}</strong>. Anything you create here
                  is visible and editable by everyone in this workspace — it can&apos;t be private.
                </span>
              </p>
            )}
          </form>
        </Card>
      )}

      {(apps.data?.items.length ?? 0) > 0 || filtrando(filtros) ? (
        <AppFiltersBar
          filtros={filtros}
          etiquetas={apps.data?.availableTags ?? []}
          onChange={onFiltros}
        />
      ) : null}

      {apps.isPending && <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>}

      {apps.data?.items.length === 0 &&
        !creating &&
        (filtrando(filtros) ? (
          <NoMatches
            onClear={() => {
              onFiltros({ sort: filtros.sort ?? 'updated', page: 1 });
            }}
          />
        ) : (
          <EmptyState
            onCreate={() => {
              setCreating(true);
            }}
          />
        ))}

      {/*
        Columnas CSS en lugar de rejilla: cada tarjeta ocupa su altura y la
        siguiente sube a llenar el hueco, sin espacios muertos.

        El precio es que el orden visual pasa a ser por columna —arriba abajo, y
        luego la siguiente— en vez de en zigzag. Se asume porque el listado va
        ordenado por actividad reciente y lo más reciente sigue estando arriba
        del todo a la izquierda, que es donde se mira primero.

        El masonry nativo de CSS resolvería ambas cosas a la vez, pero ningún
        navegador lo implementa todavía. El orden del DOM no cambia, así que la
        navegación por teclado y los lectores de pantalla recorren las tarjetas
        en su orden real.
      */}
      <ul className="columns-1 gap-3 sm:columns-2">
        {apps.data?.items.map((app) => (
          // `break-inside-avoid` impide que una tarjeta se parta entre columnas.
          <li key={app.id} className="mb-3 break-inside-avoid">
            <AppCard
              app={app}
              onOpen={() => {
                onOpen(app.id);
              }}
            />
          </li>
        ))}
      </ul>

      <Pagination
        page={apps.data?.page ?? 1}
        perPage={apps.data?.perPage ?? 24}
        total={apps.data?.total ?? 0}
        onPage={(page) => {
          onFiltros({ ...filtros, page });
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

/** Si hay algo puesto, «no hay resultados» significa otra cosa que «no hay nada». */
function filtrando(filtros: AppFilters): boolean {
  return Boolean(
    filtros.status?.length ||
    filtros.tag?.length ||
    filtros.accessLevel?.length ||
    (filtros.archived && filtros.archived !== 'hide'),
  );
}

function Pagination({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const paginas = Math.ceil(total / perPage);
  // Con una sola página, unos controles de paginación solo estorban.
  if (paginas <= 1) return null;

  return (
    <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
      <Button
        variant="secondary"
        className="px-2 py-1 text-xs"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        Previous
      </Button>
      <span className="text-xs text-[var(--color-texto-suave)]">
        Page {page} of {paginas}
      </span>
      <Button
        variant="secondary"
        className="px-2 py-1 text-xs"
        disabled={page >= paginas}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        Next
      </Button>
    </nav>
  );
}

/**
 * Vacío por filtros, que no es lo mismo que vacío de verdad (RF-610).
 *
 * Quien llega aquí no necesita que le animen a crear su primera app: ya tiene
 * apps, lo que no encuentra es las que buscaba. Lo útil es la salida.
 */
function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      <span className="text-3xl" aria-hidden>
        🔍
      </span>
      <p className="font-medium">Nothing matches these filters</p>
      <p className="max-w-sm text-sm text-[var(--color-texto-suave)]">
        There are apps here, just not with this combination.
      </p>
      <Button variant="secondary" onClick={onClear}>
        Clear filters
      </Button>
    </Card>
  );
}

function AppCard({ app, onOpen }: { app: App; onOpen: () => void }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-3 p-4 transition',
        'hover:border-[var(--color-acento)]/40 hover:shadow-md',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-acento)]',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg text-lg',
            ICON_BACKGROUNDS[app.icon.color] ?? ICON_BACKGROUNDS['slate'],
          )}
          aria-hidden
        >
          {app.icon.emoji}
        </span>

        <span className="min-w-0 flex-1">
          {/* El nombre manda y el estado le acompaña a la derecha; la
              visibilidad, más discreta, cierra la línea. */}
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium">{app.name}</span>
            <StatusPill status={app.isArchived ? 'ARCHIVED' : app.status} />
            <VisibilityMark accessLevel={app.accessLevel} />
          </span>
          <span className="block truncate text-xs text-[var(--color-texto-suave)]">
            @{app.precursorHandle}
          </span>
        </span>
      </div>

      {app.shortDescription && (
        <p className="line-clamp-2 text-sm text-[var(--color-texto-suave)]">
          {app.shortDescription}
        </p>
      )}

      {/* Las etiquetas van al pie y en tono apagado: son clasificación de quien
          escribe, no información del sistema. */}
      <TagList tags={app.tags} />
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      <span className="text-3xl" aria-hidden>
        💡
      </span>
      <p className="font-medium">Nothing here yet</p>
      <p className="max-w-sm text-sm text-[var(--color-texto-suave)]">
        An app starts as a vision: a few paragraphs about what you&apos;d build and why. You can
        refine it later — the point is to get it out of your head.
      </p>
      <Button onClick={onCreate}>Write your first vision</Button>
    </Card>
  );
}
