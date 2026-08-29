import type { WorkspaceBackground } from '@app-foundry/core';

/**
 * Catálogo de fondos.
 *
 * Son degradados y patrones definidos aquí, no imágenes: se envían con la
 * aplicación, pesan nada y se adaptan solos al tema claro y oscuro. La base de
 * datos guarda únicamente cuál está elegido.
 *
 * Todos son suaves a propósito. Un fondo de cabecera compite con el contenido
 * si tiene demasiado contraste, y lo que hay que leer son los nombres de las
 * apps, no el decorado.
 */
export const BACKGROUNDS: Record<WorkspaceBackground, { label: string; style: string }> = {
  plain: {
    label: 'Plain',
    style: 'bg-[var(--color-superficie)]',
  },
  dawn: {
    label: 'Dawn',
    style: 'bg-gradient-to-br from-amber-500/25 via-rose-500/15 to-transparent',
  },
  dusk: {
    label: 'Dusk',
    style: 'bg-gradient-to-br from-indigo-500/25 via-violet-500/15 to-transparent',
  },
  forest: {
    label: 'Forest',
    style: 'bg-gradient-to-br from-emerald-500/25 via-teal-500/15 to-transparent',
  },
  ocean: {
    label: 'Ocean',
    style: 'bg-gradient-to-br from-sky-500/25 via-cyan-500/10 to-transparent',
  },
  ember: {
    label: 'Ember',
    style: 'bg-gradient-to-br from-orange-500/25 via-rose-500/15 to-transparent',
  },
  grid: {
    label: 'Grid',
    // Patrón dibujado con degradados repetidos: sin imágenes que descargar.
    style:
      'bg-[var(--color-superficie)] [background-image:repeating-linear-gradient(0deg,var(--color-borde)_0_1px,transparent_1px_20px),repeating-linear-gradient(90deg,var(--color-borde)_0_1px,transparent_1px_20px)]',
  },
  dots: {
    label: 'Dots',
    style:
      'bg-[var(--color-superficie)] [background-image:radial-gradient(var(--color-borde)_1.2px,transparent_1.2px)] [background-size:16px_16px]',
  },
};

export function backgroundStyle(background: string): string {
  return (BACKGROUNDS[background as WorkspaceBackground] ?? BACKGROUNDS.plain).style;
}
