import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  type App,
  type AppFilters,
  useAiTaskAvailable,
  useApps,
  useCreateApp,
  type Workspace,
} from '../lib/api.js';
import { IdeaGenerator, IdeaTrigger } from '../components/idea-generator.js';
import { AppFiltersBar } from '../components/app-filters.js';
import { StatusPill, TagList, VisibilityMark } from '../components/app-status.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { ICON_BACKGROUNDS } from '../components/icon-picker.js';
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
  /* Sin IA disponible aquí, la vía no aparece: igual que el asistente (RF-1010). */
  const puedeGenerar = useAiTaskAvailable(workspace.id, 'IDEA_GENERATION');
  const [ideasAbiertas, setIdeasAbiertas] = useState(false);
  const [name, setName] = useState('');
  const campoNombre = useRef<HTMLInputElement>(null);

  // El atajo ya no abre nada: lleva el cursor al campo, que está siempre puesto.
  useEffect(() => {
    if (crearAhora > 0) campoNombre.current?.focus();
  }, [crearAhora]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(name.trim(), {
      onSuccess: (app) => {
        setName('');
        // Se entra directamente a escribir: crear una app y quedarse mirando
        // la lista sería dejar el trabajo a medias.
        onOpen(app.id);
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/*
        El título sigue existiendo aunque ya no se dibuje: quitarlo del todo deja
        la página sin encabezado, y de ahí cuelga la navegación por encabezados y
        lo que anuncia un lector de pantalla al llegar. A la vista está en la
        ruta de la cabecera, que es donde tiene sentido leerlo.
      */}
      <h1 className="sr-only">{workspace.name}</h1>

      {/*
        El formulario está siempre, en vez de tras un botón que lo despliega.
        Crear una app es la acción principal de esta pantalla, y un campo listo
        para escribir invita más que un botón que solo promete otro campo.

        Sin título encima: lo que había que preguntar cabe dentro del propio
        campo, y así la caja ocupa una línea en lugar de tres.
      */}
      <Card className="p-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              id="app-name"
              ref={campoNombre}
              required
              // El campo se queda sin etiqueta visible, así que la lleva aquí:
              // un `placeholder` desaparece al escribir y un lector de pantalla
              // no lo anuncia como nombre del campo.
              aria-label="What's the idea called?"
              placeholder="What's the idea called?"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>

            {/*
              La otra forma de empezar, en la misma fila y no en otra pantalla:
              son las dos maneras de hacer lo mismo, y quien llega sin idea no
              tiene por qué saber que hay un rincón aparte donde se le ayuda
              (RF-1301).
            */}
            {puedeGenerar && !ideasAbiertas && (
              <IdeaTrigger
                onAbrir={() => {
                  setIdeasAbiertas(true);
                }}
              />
            )}
          </div>

          {puedeGenerar && ideasAbiertas && (
            <IdeaGenerator
              workspaceId={workspace.id}
              onCreated={onOpen}
              onCerrar={() => {
                setIdeasAbiertas(false);
              }}
            />
          )}

          {workspace.role !== 'OWNER' && (
            /*
             * En un workspace ajeno lo que crees es del workspace: visible y
             * editable por todos, y no puedes hacerlo privado (RF-606).
             *
             * Se dice aquí, antes de escribir, y no al descubrirlo después:
             * quien iba a apuntar algo personal tiene que poder cambiar de idea
             * mientras todavía es gratis.
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

      {/* Los filtros aparecen cuando hay algo que filtrar, o cuando ya hay algo
          puesto: si no, ocuparían sitio prometiendo acotar una lista vacía. */}
      {((apps.data?.items.length ?? 0) > 0 || filtrando(filtros)) && (
        <AppFiltersBar
          filtros={filtros}
          etiquetas={apps.data?.availableTags ?? []}
          total={apps.data?.total ?? 0}
          onChange={onFiltros}
        />
      )}

      {apps.isPending && <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>}

      {apps.data?.items.length === 0 &&
        (filtrando(filtros) ? (
          <NoMatches
            onClear={() => {
              onFiltros({ sort: filtros.sort ?? 'updated', page: 1 });
            }}
          />
        ) : (
          <EmptyState />
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

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Las etiquetas van al pie y en tono apagado: son clasificación de
            quien escribe, no información del sistema. */}
        <TagList tags={app.tags} />

        {/* Y las conversaciones abiertas al final (RF-811): dice dónde hay algo
            esperando respuesta sin tener que entrar a mirar. */}
        {app.openThreads > 0 && (
          <span className="flex items-center gap-1 text-xs text-[var(--color-texto-suave)]">
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M13.5 8.5a4.5 4.5 0 0 1-4.5 4.5H6l-3 2v-2.6A4.5 4.5 0 0 1 2.5 8V7a4.5 4.5 0 0 1 4.5-4.5h2A4.5 4.5 0 0 1 13.5 7Z" />
            </svg>
            {app.openThreads}
          </span>
        )}
      </span>
    </Card>
  );
}

/**
 * Workspace sin apps (RF-610).
 *
 * Ya no lleva botón: el campo para crear está justo encima, y repetir aquí la
 * misma acción a dos centímetros solo obliga a decidir cuál de las dos usar.
 */
function EmptyState() {
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
    </Card>
  );
}
