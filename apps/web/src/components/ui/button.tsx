import type { ComponentProps } from 'react';

import { cn } from '../../lib/utils.js';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-[var(--color-acento)] text-[var(--color-acento-texto)] hover:opacity-90 shadow-sm',
  secondary:
    'border border-[var(--color-borde)] bg-[var(--color-superficie)] hover:bg-[var(--color-fondo)]',
  danger: 'border border-transparent text-[var(--color-fallo)] hover:bg-[var(--color-fallo)]/10',
  ghost: 'hover:bg-[var(--color-borde)]/40',
};

export function Button({
  className,
  variant = 'primary',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium',
        'transition focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-[var(--color-acento)]',
        // El navegador le pone a `<button>` la flecha de siempre, que es la del
        // texto de al lado: nada en el puntero dice que esto se puede pulsar.
        // La mano lo dice antes de leer nada. Deshabilitado manda sobre esto:
        // `:disabled` gana por especificidad, sin depender del orden.
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
