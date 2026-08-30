import { useEffect } from 'react';

import { TECLA_MOD } from '../lib/shortcuts.js';
import { cn } from '../lib/utils.js';

const ATAJOS: { teclas: string[]; que: string }[] = [
  { teclas: [TECLA_MOD, 'K'], que: 'Search everything' },
  { teclas: ['/'], que: 'Search everything' },
  { teclas: ['N'], que: 'New app' },
  { teclas: [TECLA_MOD, 'S'], que: 'Save the vision you are editing' },
  { teclas: ['Esc'], que: 'Close what is open' },
  { teclas: ['?'], que: 'This list' },
];

/**
 * La lista de atajos (RF-611).
 *
 * Unos atajos que nadie conoce no existen, y ponerlos en la documentación es
 * ponerlos donde nadie mira. Esto se abre con «?», que es la convención, y desde
 * el pie de la barra de búsqueda para quien no la conozca.
 */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className={cn(
          'w-full max-w-sm rounded-xl border border-[var(--color-borde)] p-5',
          'bg-[var(--color-superficie)] shadow-2xl',
        )}
      >
        <h2 className="mb-3 text-sm font-semibold">Keyboard shortcuts</h2>
        <ul className="flex flex-col gap-2">
          {ATAJOS.map((atajo) => (
            <li key={atajo.que + atajo.teclas.join()} className="flex items-center gap-3 text-sm">
              <span className="flex gap-1">
                {atajo.teclas.map((tecla) => (
                  <kbd
                    key={tecla}
                    className="rounded border border-[var(--color-borde)] bg-[var(--color-fondo)] px-1.5 py-0.5 text-xs"
                  >
                    {tecla}
                  </kbd>
                ))}
              </span>
              <span className="text-[var(--color-texto-suave)]">{atajo.que}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
