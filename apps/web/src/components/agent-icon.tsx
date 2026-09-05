import { cn } from '../lib/utils.js';
import { ICON_BACKGROUNDS } from './icon-picker.js';

/**
 * El icono de un agente.
 *
 * Cuadrado y con la misma paleta que una app, no redondo como un avatar: un
 * agente no es una persona, y la primera diferencia que se ve tiene que ser la
 * forma (RF-1506). El distintivo textual va aparte, porque el icono solo no
 * basta —un emoji de colores lo tiene también un compañero— y quien no
 * distingue colores necesita leerlo (RF-1611).
 */
export function AgentIcon({
  emoji,
  color,
  size = 'md',
}: {
  emoji: string;
  color: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded',
        size === 'sm' ? 'size-5 text-[11px]' : 'size-8 text-base',
        ICON_BACKGROUNDS[color] ?? ICON_BACKGROUNDS['slate'],
      )}
      aria-hidden
    >
      {emoji}
    </span>
  );
}
