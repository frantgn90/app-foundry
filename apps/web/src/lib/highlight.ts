/**
 * Resalta en el documento el fragmento de un hilo (RF-810).
 *
 * Se usa la Custom Highlight API: pinta un rango sin tocar el DOM, así que el
 * HTML renderizado no se altera y no hay que envolver texto en `<span>` ni
 * deshacerlo después. Donde no esté disponible, simplemente no se resalta —el
 * panel sigue funcionando— en lugar de manipular el árbol.
 */
const HIGHLIGHT_NAME = 'foundry-anchor';

/** Encuentra el nodo de texto y el desplazamiento para una posición del fuente. */
function locate(root: HTMLElement, sourceOffset: number): { node: Text; offset: number } | null {
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-src-start]')];

  const block = blocks.find((element) => {
    const start = Number(element.dataset['srcStart']);
    const end = Number(element.dataset['srcEnd']);
    return sourceOffset >= start && sourceOffset <= end;
  });
  if (!block) return null;

  const blockStart = Number(block.dataset['srcStart']);
  // El desplazamiento dentro del bloque coincide con el del texto renderizado
  // mientras no haya marcado por medio, que es el caso corriente en prosa.
  const within = sourceOffset - blockStart;

  let seen = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    if (seen + length >= within) {
      return { node, offset: Math.min(Math.max(within - seen, 0), length) };
    }
    seen += length;
    node = walker.nextNode() as Text | null;
  }

  // Si el desplazamiento cae más allá del texto renderizado —porque el bloque
  // llevaba marcado—, se resalta desde el principio del bloque antes que nada.
  const first = block.firstChild;
  return first instanceof Text ? { node: first, offset: 0 } : null;
}

export function highlightAnchor(
  root: HTMLElement | null,
  anchor: { start: number; end: number } | null,
): void {
  if (!('highlights' in CSS)) return;

  const highlights = CSS.highlights as Map<string, Highlight>;
  highlights.delete(HIGHLIGHT_NAME);
  if (!root || !anchor) return;

  const from = locate(root, anchor.start);
  const to = locate(root, anchor.end);
  if (!from || !to) return;

  try {
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    highlights.set(HIGHLIGHT_NAME, new Highlight(range));

    // Se lleva a la vista el bloque, no el rango: centrar un rango de dos
    // palabras deja la pantalla sin contexto alrededor.
    (from.node.parentElement ?? root).scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch {
    // Un rango inválido —el documento cambió entre el cálculo y el pintado— no
    // debe romper la lectura.
    highlights.delete(HIGHLIGHT_NAME);
  }
}
