import { cn } from '../lib/utils.js';

/**
 * Marca de App Foundry.
 *
 * Un molde abierto del que sale una chispa: la fundición da forma a algo que
 * antes era materia suelta, que es lo que hace este sitio con las ideas.
 *
 * Va en trazo y con `currentColor` a propósito. Un logotipo de colores fijos
 * habría que dibujarlo dos veces para el tema claro y el oscuro, y a 20 píxeles
 * el relleno se emborrona mientras el trazo se sigue leyendo.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('size-5', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="App Foundry"
    >
      {/* El molde: abierto por arriba, porque lo que sale de aquí no está cerrado. */}
      <path d="M4 8V6a2 2 0 0 1 2-2h3" />
      <path d="M20 8V6a2 2 0 0 0-2-2h-3" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
      {/* La chispa. */}
      <path d="M12 7.5 13.2 10.3 16 11.5 13.2 12.7 12 15.5 10.8 12.7 8 11.5 10.8 10.3Z" />
    </svg>
  );
}
