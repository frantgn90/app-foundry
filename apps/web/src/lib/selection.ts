/**
 * Traduce una selección del navegador a una posición en el markdown original.
 *
 * El usuario selecciona sobre el HTML renderizado, pero el ancla tiene que
 * expresarse en el texto fuente, que es lo que se guarda y lo que cambia. El
 * puente son los atributos `data-src-start` que el renderizador deja en cada
 * bloque (TRD §9.1).
 *
 * Devuelve `null` cuando no puede resolverlo con certeza. Es deliberado: más
 * vale no ofrecer comentar sobre una selección rara que anclar un comentario en
 * un sitio inventado.
 */
export interface SourceSelection {
  quote: string;
  start: number;
  end: number;
}

export function resolveSelection(content: string, root: HTMLElement): SourceSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = selection.toString().trim();
  if (text.length < 3) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const block = bloqueDe(range.commonAncestorContainer, root);
  if (!block) return null;

  const blockStart = Number(block.dataset['srcStart']);
  const blockEnd = Number(block.dataset['srcEnd']);
  if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return null;

  /*
   * Se busca el texto seleccionado dentro del fragmento de markdown que
   * corresponde a ese bloque. Coincide siempre que la selección no cruce
   * marcado —negritas, enlaces—, que es el caso corriente al comentar sobre una
   * frase. Cuando no coincide, se prefiere no anclar antes que aproximar.
   */
  const source = content.slice(blockStart, blockEnd);
  const offset = source.indexOf(text);
  if (offset === -1) return null;

  return { quote: text, start: blockStart + offset, end: blockStart + offset + text.length };
}

/** El bloque renderizado que contiene la selección, con su rastro de posición. */
function bloqueDe(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.dataset['srcStart'] !== undefined) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}
