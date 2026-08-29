import { type FormEvent, useState } from 'react';

import { type App, useApps, useCreateApp, type Workspace } from '../lib/api.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { cn } from '../lib/utils.js';

/** Colores de la paleta acotada, en su versión clara y oscura. */
const ICON_BACKGROUNDS: Record<string, string> = {
  amber: 'bg-amber-500/15',
  rose: 'bg-rose-500/15',
  violet: 'bg-violet-500/15',
  indigo: 'bg-indigo-500/15',
  sky: 'bg-sky-500/15',
  teal: 'bg-teal-500/15',
  emerald: 'bg-emerald-500/15',
  lime: 'bg-lime-500/15',
  orange: 'bg-orange-500/15',
  slate: 'bg-slate-500/15',
};

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
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          <p className="text-sm text-[var(--color-texto-suave)]">
            {apps.data?.length
              ? `${String(apps.data.length)} idea${apps.data.length === 1 ? '' : 's'} here`
              : 'No ideas here yet'}
          </p>
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

      <ul className="grid gap-3 sm:grid-cols-2">
        {apps.data?.map((app) => (
          <li key={app.id}>
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
        'flex h-full cursor-pointer flex-col gap-3 p-4 transition',
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
          <span className="block truncate font-medium">{app.name}</span>
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

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Badge>{app.status.replace('_', ' ').toLowerCase()}</Badge>
        {app.accessLevel === 'PRIVATE' && <Badge>private</Badge>}
        {app.isArchived && <Badge tone="warning">archived</Badge>}
        {app.tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
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
