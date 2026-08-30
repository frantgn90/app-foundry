import { useEffect, useRef, useState } from 'react';

import { type SearchHit, useSearch } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { ICON_BACKGROUNDS } from './icon-picker.js';
import { StatusPill } from './app-status.js';

/**
 * Buscador global (RF-604).
 *
 * Va en un diálogo sobre todo lo demás y no en un rincón de la cabecera porque
 * buscar es interrumpir lo que estabas haciendo: mientras buscas, buscar es lo
 * único que haces.
 *
 * Los resultados cruzan workspaces, así que cada uno dice de dónde viene; sin
 * eso, dos apps con el mismo nombre en sitios distintos serían indistinguibles.
 */
export function SearchDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (hit: SearchHit) => void;
}) {
  const [texto, setTexto] = useState('');
  const [resaltado, setResaltado] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const resultados = useSearch(texto);

  const items = resultados.data?.items ?? [];

  useEffect(() => {
    entrada.current?.focus();
  }, []);

  // Al cambiar lo escrito, la selección vuelve arriba: si no, quedaría marcado
  // un resultado que ya no está en la lista.
  useEffect(() => {
    setResaltado(0);
  }, [texto]);

  function teclas(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Se navega con las flechas sin soltar el teclado, que es el sentido de
      // abrir esto con un atajo.
      e.preventDefault();
      setResaltado((v) => {
        const siguiente = e.key === 'ArrowDown' ? v + 1 : v - 1;
        return Math.max(0, Math.min(items.length - 1, siguiente));
      });
    }
    if (e.key === 'Enter') {
      const elegido = items[resaltado];
      if (elegido) onOpen(elegido);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Search apps"
        className={cn(
          'flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl',
          'border border-[var(--color-borde)] bg-[var(--color-superficie)] shadow-2xl',
        )}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-borde)] px-3">
          <svg viewBox="0 0 16 16" className="size-4 opacity-50" aria-hidden>
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <input
            ref={entrada}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
            }}
            onKeyDown={teclas}
            placeholder="Search apps, descriptions and visions…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[var(--color-texto-suave)]"
          />
          <kbd className="rounded border border-[var(--color-borde)] px-1.5 py-0.5 text-[10px] text-[var(--color-texto-suave)]">
            Esc
          </kbd>
        </div>

        <ul className="flex-1 overflow-y-auto">
          {texto.trim().length > 0 && texto.trim().length < 2 && (
            <li className="px-4 py-6 text-center text-sm text-[var(--color-texto-suave)]">
              Keep typing…
            </li>
          )}

          {texto.trim().length >= 2 && resultados.isFetching && items.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[var(--color-texto-suave)]">
              Searching…
            </li>
          )}

          {texto.trim().length >= 2 && !resultados.isFetching && items.length === 0 && (
            <li className="flex flex-col gap-1 px-4 py-8 text-center">
              <span className="text-sm">No matches for “{texto.trim()}”</span>
              <span className="text-xs text-[var(--color-texto-suave)]">
                Search covers names, descriptions and the text of every vision you can open.
              </span>
            </li>
          )}

          {items.map((hit, i) => (
            <li key={hit.id}>
              <button
                onMouseEnter={() => {
                  setResaltado(i);
                }}
                onClick={() => {
                  onOpen(hit);
                }}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-2 text-left',
                  i === resaltado && 'bg-[var(--color-fondo)]',
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded text-xs',
                      ICON_BACKGROUNDS[hit.icon.color] ?? ICON_BACKGROUNDS['slate'],
                    )}
                    aria-hidden
                  >
                    {hit.icon.emoji}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium">{hit.name}</span>
                  <StatusPill status={hit.isArchived ? 'ARCHIVED' : hit.status} />
                  {/* De dónde viene: la búsqueda cruza workspaces (RF-604). */}
                  <span className="ml-auto shrink-0 text-xs text-[var(--color-texto-suave)]">
                    {hit.workspaceName}
                  </span>
                </span>
                {(hit.excerpt ?? hit.shortDescription) && (
                  <span className="line-clamp-2 pl-8 text-xs text-[var(--color-texto-suave)]">
                    {resaltarCoincidencias(hit.excerpt ?? hit.shortDescription ?? '')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * El servidor marca lo encontrado con « », que aquí se convierte en negrita.
 *
 * Se marca en el servidor y no aquí porque allí se sabe qué palabras casaron de
 * verdad tras normalizarlas; buscarlas otra vez en el cliente fallaría justo en
 * los casos que la búsqueda por prefijo resuelve.
 */
function resaltarCoincidencias(texto: string): React.ReactNode {
  const trozos = texto.split(/«([^»]*)»/);
  return trozos.map((trozo, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-[var(--color-texto)]">
        {trozo}
      </strong>
    ) : (
      trozo
    ),
  );
}
