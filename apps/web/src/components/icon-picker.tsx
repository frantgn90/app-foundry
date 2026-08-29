import { type AppColor, APP_COLORS, type AppEmoji, APP_EMOJIS } from '@app-foundry/core';

import { cn } from '../lib/utils.js';

/** Fondos de la paleta acotada, en su versión traslúcida para ambos temas. */
export const ICON_BACKGROUNDS: Record<string, string> = {
  amber: 'bg-amber-500/15',
  rose: 'bg-rose-500/15',
  violet: 'bg-violet-500/15',
  indigo: 'bg-indigo-500/15',
  sky: 'bg-sky-500/15',
  teal: 'bg-teal-500/15',
  emerald: 'bg-emerald-500/15',
  lime: 'bg-lime-500/15',
  orange: 'bg-orange-500/15',
  slate: 'bg-slate-500/15',
};

export interface Icon {
  emoji: AppEmoji;
  color: AppColor;
}

interface Props extends Icon {
  onChange: (icon: Icon) => void;
}

/**
 * Selector de icono (RF-416).
 *
 * Muestra el catálogo entero de golpe, sin buscador: son cuarenta emojis y diez
 * colores, y una rejilla se recorre de un vistazo. Un buscador aquí obligaría a
 * saber qué se busca antes de mirar.
 */
export function IconPicker({ emoji, color, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {APP_EMOJIS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Icon ${option}`}
            aria-pressed={option === emoji}
            onClick={() => {
              onChange({ emoji: option, color });
            }}
            className={cn(
              'grid size-8 place-items-center rounded-md text-base transition',
              'hover:bg-[var(--color-borde)]/60',
              option === emoji && 'bg-[var(--color-borde)] ring-2 ring-[var(--color-acento)]',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {APP_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Colour ${option}`}
            aria-pressed={option === color}
            onClick={() => {
              onChange({ emoji, color: option });
            }}
            className={cn(
              'grid size-8 place-items-center rounded-md transition',
              ICON_BACKGROUNDS[option],
              option === color && 'ring-2 ring-[var(--color-acento)]',
            )}
          >
            <span className="text-base" aria-hidden>
              {emoji}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
