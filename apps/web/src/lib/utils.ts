import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases resolviendo conflictos de Tailwind.
 *
 * Es el helper que usan los componentes al estilo shadcn: permite que quien usa
 * un componente sobreescriba una clase concreta sin pelearse con la
 * especificidad.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
