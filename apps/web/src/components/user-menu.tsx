import { useEffect, useRef, useState } from 'react';

import { type Session, useSignOut } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { Avatar } from './ui/avatar.js';

/**
 * Menú de la cuenta.
 *
 * Reúne bajo el nombre lo que es de la persona y no del workspace: sus ajustes y
 * la salida. Es donde se busca por convención, y saca de la cabecera cosas que
 * se tocan una vez cada muchos meses —el tema, por ejemplo— y que ahí solo
 * competían por la atención con lo que se usa a diario.
 */
export function UserMenu({ session, onSettings }: { session: Session; onSettings: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();

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

  return (
    <div className="relative" ref={caja}>
      <button
        onClick={() => {
          setAbierto((v) => !v);
        }}
        className={cn(
          'flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm',
          'hover:bg-[var(--color-borde)]/40',
        )}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Account"
      >
        <Avatar src={session.avatarUrl} name={session.displayName} />
        <span className="hidden sm:inline">{session.handle}</span>
        <svg viewBox="0 0 12 12" className="size-3 opacity-60" aria-hidden>
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {abierto && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-30 mt-1 min-w-52 overflow-hidden rounded-lg',
            'border border-[var(--color-borde)] bg-[var(--color-superficie)] shadow-lg',
          )}
        >
          <div className="border-b border-[var(--color-borde)] px-3 py-2">
            <p className="truncate text-sm font-medium">{session.displayName}</p>
            <p className="truncate text-xs text-[var(--color-texto-suave)]">{session.email}</p>
          </div>

          <button
            role="menuitem"
            onClick={() => {
              setAbierto(false);
              onSettings();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-fondo)]"
          >
            Account settings
          </button>

          <button
            role="menuitem"
            onClick={() => {
              setAbierto(false);
              signOut.mutate();
            }}
            className={cn(
              'flex w-full items-center gap-2 border-t border-[var(--color-borde)] px-3 py-2',
              'text-left text-sm hover:bg-[var(--color-fondo)]',
            )}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
