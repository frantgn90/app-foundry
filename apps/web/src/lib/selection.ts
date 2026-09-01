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
  /**
   * El fragmento **del fuente**, no el texto tal como se ve.
   *
   * Tiene que ser el fuente porque el servidor comprueba que coincide con
   * `contenido.slice(start, end)` antes de crear el hilo: es su forma de saber
   * que cliente y servidor miran el mismo texto. Y no coinciden por casualidad
   * —un párrafo escrito en dos líneas lleva un salto donde la pantalla enseña un
   * espacio—, así que se recorta del fuente en lugar de copiarlo de la pantalla.
   */
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
  const rango = seleccionEnElDocumento(root);
  if (!rango || rango.toString().trim().length < MINIMO) return null;

  /*
   * Bloque a bloque, y no de una vez: cada bloque tiene su propio tramo de
   * markdown, y solo dentro de él se puede buscar lo que se marcó. Buscar el
   * texto entero dentro del fuente de un único bloque era lo que dejaba sin menú
   * cualquier selección que pasara de un párrafo al siguiente.
   */
  let start: number | null = null;
  let end: number | null = null;

  for (const bloque of bloquesDe(rango, root)) {
    /*
     * Un bloque rozado sin llegar a marcar nada no invalida la selección: el
     * triple clic termina el rango en el arranque del bloque siguiente, con
     * desplazamiento cero, así que ese bloque siempre aparece y siempre está
     * vacío.
     */
    const marcado = recortarA(rango, bloque)?.toString().trim();
    if (marcado === undefined || marcado === '') continue;

    const blockStart = Number(bloque.dataset['srcStart']);
    const blockEnd = Number(bloque.dataset['srcEnd']);
    if (Number.isNaN(blockStart) || Number.isNaN(blockEnd)) return null;

    const tramo = buscar(content.slice(blockStart, blockEnd), marcado);
    /*
     * Si en algún bloque no se encuentra lo marcado —porque la selección parte
     * el marcado por la mitad: media negrita, medio enlace— se renuncia entera.
     * Anclar solo la parte que sí se encontró dejaría el comentario sobre un
     * fragmento que no es el que se señaló.
     */
    if (!tramo) return null;

    start ??= blockStart + tramo[0];
    end = blockStart + tramo[1];
  }

  if (start === null || end === null) return null;
  return { quote: content.slice(start, end), start, end };
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
  const rango = seleccionEnElDocumento(root);
  if (!rango) return null;

  const rects = [...rango.getClientRects()].filter((r) => r.width > 0 || r.height > 0);
  return rects[rects.length - 1] ?? null;
}

/**
 * La selección, recortada a lo que cae dentro del documento.
 *
 * Recortar y no descartar es el arreglo de un fallo concreto: el navegador
 * termina la selección **fuera** del texto más a menudo de lo que parece. Con el
 * triple clic sobre el último párrafo, el rango acaba en el siguiente elemento
 * de la página —un botón—, y lo mismo pasa al arrastrar y soltar por debajo del
 * documento. Exigiendo que el rango entero cayera dentro, todas esas selecciones
 * se rechazaban aunque lo marcado fuera perfectamente válido.
 *
 * Lo que sí se exige es que el gesto **empiece o acabe** dentro del documento.
 * Sin eso, un «seleccionar todo» de la página entera —que también lo cruza—
 * pasaría por una selección sobre el texto.
 */
function seleccionEnElDocumento(root: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) && !root.contains(range.endContainer)) return null;

  return recortarA(range, root);
}

/**
 * Los bloques renderizados que toca la selección, de arriba abajo.
 *
 * Se quedan los **más internos**: un `blockquote` o un elemento de lista llevan
 * el rastro de posición y además contienen párrafos que también lo llevan, así
 * que contar los dos sería medir el mismo texto dos veces.
 */
function bloquesDe(rango: Range, root: HTMLElement): HTMLElement[] {
  const tocados = [...root.querySelectorAll<HTMLElement>('[data-src-start]')].filter((bloque) =>
    rango.intersectsNode(bloque),
  );
  return tocados.filter(
    (bloque) => !tocados.some((otro) => otro !== bloque && bloque.contains(otro)),
  );
}

/** La parte de un rango que cae dentro de un elemento, o `null` si no cae nada. */
function recortarA(rango: Range, elemento: HTMLElement): Range | null {
  const limites = window.document.createRange();
  limites.selectNodeContents(elemento);

  const trozo = rango.cloneRange();
  if (trozo.compareBoundaryPoints(Range.START_TO_START, limites) < 0) {
    trozo.setStart(limites.startContainer, limites.startOffset);
  }
  if (trozo.compareBoundaryPoints(Range.END_TO_END, limites) > 0) {
    trozo.setEnd(limites.endContainer, limites.endOffset);
  }

  /* Recortar puede dejarlo vacío: la selección pasaba de largo sin tocar esto. */
  return trozo.collapsed ? null : trozo;
}

/**
 * Busca lo marcado dentro del fuente de su bloque, sin exigir que los espacios
 * coincidan.
 *
 * Es el otro arreglo de fondo. Un párrafo se escribe muchas veces repartido en
 * varias líneas del fuente —la plantilla de la visión lo está— y el navegador
 * enseña ese salto como un espacio. Comparando carácter a carácter, el texto
 * marcado no aparecía en su propio bloque en cuanto la selección pasaba de una
 * línea del fuente a la siguiente: quedarse sin menú era el caso corriente y no
 * la excepción.
 *
 * Devuelve el tramo en posiciones del fuente, que es lo que se guarda.
 */
function buscar(fuente: string, marcado: string): [number, number] | null {
  const { texto, indices } = sinEspaciosDeMas(fuente);
  const aguja = sinEspaciosDeMas(marcado).texto;
  if (aguja === '') return null;

  const donde = texto.indexOf(aguja);
  if (donde === -1) return null;

  const primero = indices[donde];
  const ultimo = indices[donde + aguja.length - 1];
  if (primero === undefined || ultimo === undefined) return null;

  return [primero, ultimo + 1];
}

/**
 * El mismo texto con cada racha de espacios reducida a uno, y de dónde salió
 * cada carácter.
 *
 * El rastro de posiciones es lo que permite volver del texto comparado al
 * fuente: sin él se sabría que coincide, pero no dónde.
 */
function sinEspaciosDeMas(texto: string): { texto: string; indices: number[] } {
  let salida = '';
  const indices: number[] = [];
  let veniaEnBlanco = false;

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i]!;
    if (/\s/.test(caracter)) {
      /* Ni al principio ni repetido: un espacio suelto entre dos palabras. */
      if (!veniaEnBlanco && salida !== '') {
        salida += ' ';
        indices.push(i);
      }
      veniaEnBlanco = true;
      continue;
    }
    veniaEnBlanco = false;
    salida += caracter;
    indices.push(i);
  }

  return { texto: salida, indices };
}
