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

/**
 * Dos caracteres, no tres.
 *
 * El mínimo existe para no anclar sobre un fragmento tan corto que aparezca en
 * todas partes, pero tres dejaba fuera el doble clic sobre palabras cortas —«no
 * vale», «app», «se»—, que es un gesto de lo más normal. Con dos, el anclaje por
 * cita más su contexto (TRD §9) sigue teniendo con qué desambiguar.
 */
const MINIMO = 2;

export function resolveSelection(content: string, root: HTMLElement): SourceSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = selection.toString().trim();
  if (text.length < MINIMO) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const block = bloqueDe(range, root);
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

/**
 * Dónde está la selección en la pantalla, para colocar el menú.
 *
 * Se devuelve el **último** rectángulo, que es donde acaba visualmente la
 * selección. Es lo que permite poner el menú debajo y a su derecha sin depender
 * del ratón: con el puntero como referencia, arrastrar deprisa lo deja lejos del
 * texto, y arrastrar de derecha a izquierda lo deja al principio, porque ahí es
 * donde termina el gesto (RF-1414).
 */
export function selectionRect(root: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const rects = [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
  return rects[rects.length - 1] ?? null;
}

/**
 * El bloque renderizado al que pertenece la selección, con su rastro de posición.
 *
 * Se sube desde **el principio** de la selección, no desde su contenedor común.
 * La diferencia importa: cuando la selección cubre un bloque entero —un título,
 * un párrafo completo—, el contenedor común pasa a ser el elemento padre, que ya
 * no lleva el rastro, y subir desde ahí no encuentra nada. Por eso seleccionar
 * un título no ofrecía menú, y no por ser markdown (RF-1416).
 *
 * Y **no** se exige que el final caiga en el mismo bloque, aunque suene
 * razonable: al seleccionar un bloque entero con triple clic, el navegador
 * termina el rango en el arranque del bloque siguiente, con desplazamiento cero.
 * Es decir, dice que llega hasta ahí sin haber seleccionado nada de él. Exigir
 * coincidencia rechazaba justo el gesto que se quería arreglar.
 *
 * Quien impide anclar una selección que cruza dos bloques no es esta función,
 * sino la búsqueda de la cita: el fuente de un bloque no contiene el texto de
 * dos, así que no se encuentra y se devuelve `null` unas líneas más abajo.
 */
function bloqueDe(range: Range, root: HTMLElement): HTMLElement | null {
  return subirHasta(range.startContainer, root) ?? subirHasta(range.endContainer, root);
}

function subirHasta(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.dataset['srcStart'] !== undefined) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}
