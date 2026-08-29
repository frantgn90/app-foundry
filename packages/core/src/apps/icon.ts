/**
 * Iconos de app: un emoji y un color de fondo (RF-415, RF-416, D-14).
 *
 * No se suben ficheros. El icono son datos, así que no hace falta almacenamiento
 * de objetos y RD-7 sigue intacto.
 */

/**
 * Selección curada, no el catálogo Unicode entero.
 *
 * Una lista corta se elige más rápido y mantiene la coherencia visual del
 * listado; con doce mil emojis, dos apps cualesquiera acaban pareciendo de
 * productos distintos.
 */
export const APP_EMOJIS = [
  // Ideas y comienzos
  '💡',
  '✨',
  '🌱',
  '🔮',
  '🚀',
  '🧭',
  // Herramientas y oficio
  '🛠️',
  '⚙️',
  '🧰',
  '🔧',
  '📐',
  '🧪',
  // Conocimiento
  '📚',
  '📝',
  '🧠',
  '🔍',
  '🗺️',
  '📊',
  // Comunicación
  '💬',
  '📣',
  '📨',
  '🤝',
  '🎙️',
  '📡',
  // Objetos y lugares
  '🏗️',
  '🧱',
  '🗂️',
  '🎛️',
  '🪟',
  '🧩',
  // Naturaleza y tiempo
  '🌊',
  '🌲',
  '⛰️',
  '🌙',
  '☀️',
  '⏳',
  // Juego y ritmo
  '🎯',
  '🎲',
  '🎨',
  '🎵',
  '🏔️',
  '🔥',
] as const;

/** Paleta acotada: colores que funcionan en tema claro y oscuro. */
export const APP_COLORS = [
  'amber',
  'rose',
  'violet',
  'indigo',
  'sky',
  'teal',
  'emerald',
  'lime',
  'orange',
  'slate',
] as const;

export type AppEmoji = (typeof APP_EMOJIS)[number];
export type AppColor = (typeof APP_COLORS)[number];

export interface AppIcon {
  emoji: string;
  color: string;
}

/**
 * Icono por defecto, derivado del identificador de la app.
 *
 * Determinista a propósito: la misma app tiene siempre el mismo icono, y dos
 * apps creadas seguidas salen distintas. Un emoji al azar daría repeticiones
 * incómodas en un listado corto, y uno fijo haría que todas se parecieran.
 */
export function defaultIcon(id: string): AppIcon {
  const hash = hashCode(id);
  return {
    emoji: APP_EMOJIS[hash % APP_EMOJIS.length] ?? '💡',
    // Se desplaza el hash para que emoji y color no queden correlacionados: si
    // ambos salieran del mismo resto, dos apps con el mismo emoji tendrían
    // siempre el mismo color.
    color: APP_COLORS[Math.floor(hash / APP_EMOJIS.length) % APP_COLORS.length] ?? 'slate',
  };
}

export function isValidIcon({ emoji, color }: AppIcon): boolean {
  return (
    (APP_EMOJIS as readonly string[]).includes(emoji) &&
    (APP_COLORS as readonly string[]).includes(color)
  );
}

/** FNV-1a: pequeño, estable y sin dependencias. No se usa para nada sensible. */
function hashCode(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
