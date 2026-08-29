/**
 * Aspecto de un workspace.
 *
 * Un espacio propio se reconoce antes por su color que por su nombre, sobre
 * todo cuando se pertenece a varios. Por eso se puede personalizar; y por eso
 * el catálogo es acotado, para que elegir sea rápido y ninguna combinación
 * quede ilegible.
 *
 * Los fondos son degradados y patrones definidos en la interfaz: aquí solo se
 * guarda cuál está elegido. Personalizar un workspace no obliga a montar
 * almacenamiento de ficheros (RD-7), y añadir uno nuevo es añadirlo al
 * catálogo.
 */
export const WORKSPACE_EMOJIS = [
  '🗂️',
  '🏠',
  '🧭',
  '⚗️',
  '🌳',
  '🛰️',
  '🏛️',
  '🎪',
  '⛺',
  '🌋',
  '🗼',
  '🧵',
  '🪴',
  '🧊',
  '🎠',
  '🛖',
] as const;

export const WORKSPACE_BACKGROUNDS = [
  'plain',
  'dawn',
  'dusk',
  'forest',
  'ocean',
  'ember',
  'grid',
  'dots',
] as const;

export type WorkspaceEmoji = (typeof WORKSPACE_EMOJIS)[number];
export type WorkspaceBackground = (typeof WORKSPACE_BACKGROUNDS)[number];

export function isValidWorkspaceEmoji(value: string): value is WorkspaceEmoji {
  return (WORKSPACE_EMOJIS as readonly string[]).includes(value);
}

export function isValidWorkspaceBackground(value: string): value is WorkspaceBackground {
  return (WORKSPACE_BACKGROUNDS as readonly string[]).includes(value);
}
