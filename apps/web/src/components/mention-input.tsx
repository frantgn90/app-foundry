import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import type { MentionableUser } from '../lib/api.js';
import { Avatar } from './ui/avatar.js';
import { cn } from '../lib/utils.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  people: MentionableUser[];
  placeholder?: string;
  autoFocus?: boolean;
}

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
  placeholder = 'Write a comment…',
  autoFocus = false,
}: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return people.filter((p) => p.handle.toLowerCase().startsWith(needle)).slice(0, 5);
  }, [query, people]);

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
          {matches.map((person, index) => (
            <li key={person.userId}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(e) => {
                  // mousedown y no click: el click llega después de que el
                  // textarea pierda el foco y la selección ya se habría movido.
                  e.preventDefault();
                  complete(person.handle);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                  index === highlighted
                    ? 'bg-[var(--color-fondo)]'
                    : 'hover:bg-[var(--color-fondo)]',
                )}
              >
                <Avatar src={person.avatarUrl} name={person.displayName} className="size-5" />
                <span className="font-medium">@{person.handle}</span>
                <span className="truncate text-xs text-[var(--color-texto-suave)]">
                  {person.displayName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
