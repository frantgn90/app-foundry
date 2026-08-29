import { type FormEvent, useState } from 'react';

import { type App, useApps, useCreateApp, type Workspace } from '../lib/api.js';
import { StatusPill, TagList, VisibilityMark } from '../components/app-status.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { ICON_BACKGROUNDS } from '../components/icon-picker.js';
import { backgroundStyle } from '../components/workspace-background.js';
import { cn } from '../lib/utils.js';

export function AppsListPage({
  workspace,
  onOpen,
}: {
  workspace: Workspace;
  onOpen: (appId: string) => void;
}) {
  const apps = useApps(workspace.id);
  const create = useCreateApp(workspace.id);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

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
              {apps.data?.length
                ? `${String(apps.data.length)} idea${apps.data.length === 1 ? '' : 's'} here`
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
            <p className="text-xs text-[var(--color-texto-suave)]">
              You can rename it later. What matters now is writing the vision.
            </p>
          </form>
        </Card>
      )}

      {apps.isPending && <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>}

      {apps.data?.length === 0 && !creating && (
        <EmptyState
          onCreate={() => {
            setCreating(true);
          }}
        />
      )}

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
        {apps.data?.map((app) => (
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
    </div>
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
