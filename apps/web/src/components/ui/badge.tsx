import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils.js';

type Tone = 'neutral' | 'ok' | 'warning' | 'ai';

const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--color-borde)]/50 text-[var(--color-texto-suave)]',
  ok: 'bg-[var(--color-ok)]/15 text-[var(--color-ok)]',
  warning: 'bg-[var(--color-fallo)]/12 text-[var(--color-fallo)]',
  /*
   * Lo que ha escrito un modelo (RF-1701, RF-1611).
   *
   * Tono propio y no el neutro: marcar la IA con el mismo gris que «editado» la
   * dejaría al nivel de un detalle, y no lo es. Va con el color de acento, que
   * es el que el producto usa para lo que hay que mirar.
   */
  ai: 'bg-[var(--color-acento)]/12 text-[var(--color-acento)]',
};

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
