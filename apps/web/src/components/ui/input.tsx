import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils.js';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-[var(--color-borde)] bg-[var(--color-fondo)]',
        'px-3 py-2 text-sm placeholder:text-[var(--color-texto-suave)]',
        'focus-visible:border-[var(--color-acento)] focus-visible:outline-2',
        'focus-visible:outline-offset-0 focus-visible:outline-[var(--color-acento)]/40',
        className,
      )}
      {...props}
    />
  );
}
