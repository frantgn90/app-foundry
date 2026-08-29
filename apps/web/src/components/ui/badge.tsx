import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils.js';

type Tone = 'neutral' | 'ok' | 'warning';

const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--color-borde)]/50 text-[var(--color-texto-suave)]',
  ok: 'bg-[var(--color-ok)]/15 text-[var(--color-ok)]',
  warning: 'bg-[var(--color-fallo)]/12 text-[var(--color-fallo)]',
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
