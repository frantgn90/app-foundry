/**
 * Resalta en el documento los fragmentos que tienen conversación (RF-810).
 *
 * Se usa la Custom Highlight API: pinta rangos sin tocar el DOM, así que el
 * HTML renderizado no se altera y no hay que envolver texto en `<span>` ni
 * deshacerlo después. Donde no esté disponible, simplemente no se resalta —el
 * panel sigue funcionando— en lugar de manipular el árbol.
 *
 * Hay dos capas: todos los fragmentos comentados en un tono suave, y el del
 * hilo seleccionado más marcado. Sin la primera, la conversación existente sería
 * invisible hasta que a alguien se le ocurriera abrir el panel.
 */
const ALL = 'foundry-anchors';
const ACTIVE = 'foundry-anchor-active';
const PENDING = 'foundry-anchor-pending';

export interface AnchorRange {
  threadId: string;
  start: number;
  end: number;
}

/** Nodo de texto y desplazamiento correspondientes a una posición del fuente. */
function locate(root: HTMLElement, sourceOffset: number): { node: Text; offset: number } | null {
  const block = [...root.querySelectorAll<HTMLElement>('[data-src-start]')].find((element) => {
    const start = Number(element.dataset['srcStart']);
    const end = Number(element.dataset['srcEnd']);
    return sourceOffset >= start && sourceOffset <= end;
  });
  if (!block) return null;

  // El desplazamiento dentro del bloque coincide con el del texto renderizado
  // mientras no haya marcado por medio, que es el caso corriente en prosa.
  const within = sourceOffset - Number(block.dataset['srcStart']);

  let seen = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (seen + node.data.length >= within) {
      return { node, offset: Math.min(Math.max(within - seen, 0), node.data.length) };
    }
    seen += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

function rangeFor(root: HTMLElement, anchor: AnchorRange): Range | null {
  const from = locate(root, anchor.start);
  const to = locate(root, anchor.end);
  if (!from || !to) return null;

  try {
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  } catch {
    // Un rango inválido —el documento cambió entre el cálculo y el pintado— no
    // debe romper la lectura.
    return null;
  }
}

export function paintAnchors(
  root: HTMLElement | null,
  anchors: AnchorRange[],
  activeThreadId: string | null,
  options: { scrollToActive?: boolean } = {},
): void {
  if (!('highlights' in CSS)) return;
  const highlights = CSS.highlights as Map<string, Highlight>;

  highlights.delete(ALL);
  highlights.delete(ACTIVE);
  if (!root || anchors.length === 0) return;

  const all: Range[] = [];
  let active: Range | null = null;

  for (const anchor of anchors) {
    const range = rangeFor(root, anchor);
    if (!range) continue;
    if (anchor.threadId === activeThreadId) active = range;
    else all.push(range);
  }

  if (all.length > 0) highlights.set(ALL, new Highlight(...all));
  if (active) {
    highlights.set(ACTIVE, new Highlight(active));
    if (options.scrollToActive) {
      // Se lleva a la vista el bloque, no el rango: centrar dos palabras deja
      // la pantalla sin contexto alrededor.
      const block = active.startContainer.parentElement;
      block?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

/**
 * Marca el fragmento sobre el que se está a punto de comentar.
 *
 * La selección nativa del navegador se apaga en cuanto el foco pasa al campo de
 * texto, y entonces se pierde de vista sobre qué se estaba comentando. Este
 * resaltado propio no depende del foco, así que el contexto sigue ahí mientras
 * se escribe.
 */
export function paintPending(
  root: HTMLElement | null,
  anchor: { start: number; end: number } | null,
): void {
  if (!('highlights' in CSS)) return;
  const highlights = CSS.highlights as Map<string, Highlight>;

  highlights.delete(PENDING);
  if (!root || !anchor) return;

  const range = rangeFor(root, { threadId: '', ...anchor });
  if (range) highlights.set(PENDING, new Highlight(range));
}

/**
 * Posición en el markdown correspondiente a un punto de la pantalla.
 *
 * Es el camino inverso al del resaltado, y lo que permite que pinchar un
 * fragmento comentado lleve a su hilo.
 */
export function sourceOffsetAt(root: HTMLElement, x: number, y: number): number | null {
  const caret = caretFromPoint(x, y);
  if (!caret || !root.contains(caret.node)) return null;

  let block: HTMLElement | null = caret.node.parentElement;
  while (block && block !== root && block.dataset['srcStart'] === undefined) {
    block = block.parentElement;
  }
  if (!block || block.dataset['srcStart'] === undefined) return null;

  let seen = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node === caret.node) return Number(block.dataset['srcStart']) + seen + caret.offset;
    seen += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

interface Caret {
  node: Text;
  offset: number;
}

/** Los navegadores no se ponen de acuerdo en cómo se pide esto. */
function caretFromPoint(x: number, y: number): Caret | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = doc.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode instanceof Text) {
    return { node: position.offsetNode, offset: position.offset };
  }

  const range = doc.caretRangeFromPoint?.(x, y);
  if (range?.startContainer instanceof Text) {
    return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}
