import { useState } from 'react';

import type { Session, Workspace } from '../lib/api.js';
import { useSignOut } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { Avatar } from './ui/avatar.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';

interface Props {
  session: Session;
  workspaces: Workspace[];
  current: Workspace | undefined;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}

/**
 * Cabecera con el selector de workspace y el menú de cuenta.
 *
 * El selector muestra siempre en cuál estás y marca los ajenos como
 * «Guest», porque lo que puedes hacer cambia por completo entre uno y otro
 * (RF-302, RF-606).
 */
export function Layout({ session, workspaces, current, onSelect, children }: Props) {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-borde)] bg-[var(--color-superficie)]">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-6">
          <span className="font-semibold tracking-tight">App Foundry</span>

          <span className="text-[var(--color-texto-suave)]" aria-hidden>
            /
          </span>

          <div className="relative">
            <button
              onClick={() => {
                setOpen((v) => !v);
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium',
                'hover:bg-[var(--color-borde)]/40',
              )}
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              {current?.name ?? 'Select a workspace'}
              {current && current.role !== 'OWNER' && <Badge>Guest</Badge>}
              <svg viewBox="0 0 12 12" className="size-3 opacity-60" aria-hidden>
                <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>

            {open && (
              <ul
                role="listbox"
                className={cn(
                  'absolute left-0 top-full z-10 mt-1 min-w-56 overflow-hidden rounded-lg',
                  'border border-[var(--color-borde)] bg-[var(--color-superficie)] shadow-lg',
                )}
              >
                {workspaces.map((w) => (
                  <li key={w.id}>
                    <button
                      role="option"
                      aria-selected={w.id === current?.id}
                      onClick={() => {
                        onSelect(w.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                        'hover:bg-[var(--color-fondo)]',
                        w.id === current?.id && 'font-medium',
                      )}
                    >
                      <span className="truncate">{w.name}</span>
                      {w.role !== 'OWNER' && <Badge>Guest</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            {session.platformRole === 'ADMIN' && <Badge tone="ok">Admin</Badge>}
            <span className="flex items-center gap-2 text-sm">
              <Avatar src={session.avatarUrl} name={session.displayName} />
              <span className="hidden sm:inline">{session.handle}</span>
            </span>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => {
                signOut.mutate();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
