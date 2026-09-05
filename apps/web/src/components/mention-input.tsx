import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import type { MentionableUser } from '../lib/api.js';
import { AgentIcon } from './agent-icon.js';
import { Avatar } from './ui/avatar.js';
import { Badge } from './ui/badge.js';
import { cn } from '../lib/utils.js';

/** Un agente de esta app, tal como se ofrece al escribir `@`. */
export interface MentionableAgent {
  id: string;
  handle: string;
  name: string;
  iconEmoji: string;
  iconColor: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  people: MentionableUser[];
  /** Los agentes activos de la app. Mencionarlos los invoca (RF-1602). */
  agents?: MentionableAgent[];
  placeholder?: string;
  autoFocus?: boolean;
}

/** Lo que se ofrece al escribir `@`: personas y agentes, distinguibles. */
type Sugerencia =
  | { clase: 'persona'; handle: string; nombre: string; avatarUrl: string | null }
  | { clase: 'agente'; handle: string; nombre: string; emoji: string; color: string };

/**
 * Campo de comentario con autocompletado de menciones.
 *
 * Solo ofrece a quien la API ya ha dicho que se puede mencionar —miembros del
 * workspace—, así que escribir `@` nunca revela a nadie de fuera (RF-815). El
 * filtrado es local sobre esa lista corta: no hay consulta por cada tecla.
 */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  people,
  agents = [],
  placeholder = 'Write a comment…',
  autoFocus = false,
}: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo((): Sugerencia[] => {
    if (query === null) return [];
    const needle = query.toLowerCase();

    /*
     * Los agentes van primero.
     *
     * No es un capricho de orden: mencionar a un agente **gasta tokens y
     * escribe**, mientras que mencionar a una persona solo avisa. Lo que tiene
     * consecuencias se enseña donde se mira, no al final de una lista.
     */
    const deAgentes: Sugerencia[] = agents
      .filter((a) => a.handle.toLowerCase().startsWith(needle))
      .map((a) => ({
        clase: 'agente' as const,
        handle: a.handle,
        nombre: a.name,
        emoji: a.iconEmoji,
        color: a.iconColor,
      }));

    const dePersonas: Sugerencia[] = people
      .filter((p) => p.handle.toLowerCase().startsWith(needle))
      .map((p) => ({
        clase: 'persona' as const,
        handle: p.handle,
        nombre: p.displayName,
        avatarUrl: p.avatarUrl,
      }));

    return [...deAgentes, ...dePersonas].slice(0, 6);
  }, [query, people, agents]);

  /** Detecta si el cursor está justo después de un `@palabra` sin cerrar. */
  function updateQuery(text: string, caret: number) {
    const upToCaret = text.slice(0, caret);
    const match = /(?:^|\s)@([A-Za-z\d-]*)$/.exec(upToCaret);
    setQuery(match ? (match[1] ?? '') : null);
    setHighlighted(0);
  }

  function complete(handle: string) {
    const element = field.current;
    if (!element) return;
    const caret = element.selectionStart;
    const before = value.slice(0, caret).replace(/@[A-Za-z\d-]*$/, `@${handle} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    // El cursor va detrás del handle recién insertado, no al final del texto.
    queueMicrotask(() => {
      element.focus();
      element.setSelectionRange(before.length, before.length);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((h) => (h + 1) % matches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((h) => (h - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        complete(matches[highlighted]?.handle ?? '');
        return;
      }
      if (event.key === 'Escape') {
        setQuery(null);
        return;
      }
    }

    // Enter envía; Mayúsculas+Enter hace un salto de línea. Un comentario suele
    // ser una frase, así que lo cómodo es que Enter mande.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={field}
        value={value}
        autoFocus={autoFocus}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          updateQuery(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full resize-y rounded-lg border border-[var(--color-borde)] bg-[var(--color-fondo)]',
          'px-3 py-2 text-sm placeholder:text-[var(--color-texto-suave)]',
          'focus-visible:border-[var(--color-acento)] focus-visible:outline-none',
        )}
      />

      {matches.length > 0 && (
        <ul
          role="listbox"
          className={cn(
            'absolute bottom-full z-10 mb-1 w-64 overflow-hidden rounded-lg',
            'border border-[var(--color-borde)] bg-[var(--color-superficie)] shadow-lg',
          )}
        >
          {matches.map((sugerencia, index) => (
            <li key={`${sugerencia.clase}:${sugerencia.handle}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(e) => {
                  // mousedown y no click: el click llega después de que el
                  // textarea pierda el foco y la selección ya se habría movido.
                  e.preventDefault();
                  complete(sugerencia.handle);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                  index === highlighted
                    ? 'bg-[var(--color-fondo)]'
                    : 'hover:bg-[var(--color-fondo)]',
                )}
              >
                {sugerencia.clase === 'agente' ? (
                  <AgentIcon emoji={sugerencia.emoji} color={sugerencia.color} size="sm" />
                ) : (
                  <Avatar src={sugerencia.avatarUrl} name={sugerencia.nombre} className="size-5" />
                )}
                <span className="font-medium">@{sugerencia.handle}</span>
                <span className="truncate text-xs text-[var(--color-texto-suave)]">
                  {sugerencia.nombre}
                </span>
                {/* Se dice cuál es cuál antes de elegir, no después (RF-1506). */}
                {sugerencia.clase === 'agente' && (
                  <Badge tone="ai" className="ml-auto">
                    AI
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
