/**
 * Anclaje de comentarios a fragmentos de un documento que sigue cambiando.
 *
 * El problema no es guardar dónde estaba un comentario, sino volver a
 * encontrarlo cuando el texto de alrededor ya no es el mismo. Se sigue el
 * modelo de anotación del W3C: se guarda la **posición** y también la **cita**
 * con su contexto, y se usa la segunda cuando la primera deja de valer.
 *
 * El criterio que gobierna todo esto: **ante la duda, huérfano antes que
 * anclado en el sitio equivocado**. Un comentario que aparece descolgado se
 * entiende; uno pegado a un párrafo que no tiene nada que ver hace dudar de
 * todos los demás.
 */

/** Cuánto contexto se guarda a cada lado de la cita. */
export const CONTEXT_LENGTH = 32;

/**
 * Umbral de similitud para el reanclaje difuso.
 *
 * 0.75 deja pasar correcciones menores —una errata, una coma, una palabra
 * cambiada— y rechaza un párrafo reescrito. Subirlo haría huérfanos
 * comentarios que solo sufrieron una tilde; bajarlo empezaría a pegarlos en
 * fragmentos que ya dicen otra cosa.
 */
export const FUZZY_THRESHOLD = 0.75;

import type { AnchorStatus } from '../enums.js';

export interface Anchor {
  /** El texto exacto sobre el que se comentó. */
  quote: string;
  /** Contexto anterior y posterior: desambigua citas repetidas. */
  prefix: string;
  suffix: string;
  start: number;
  end: number;
}

export interface AnchorResult {
  status: AnchorStatus;
  start: number | null;
  end: number | null;
  /** Cómo se resolvió. Sirve para explicarlo y para medirlo. */
  strategy: 'exact' | 'context' | 'quote' | 'fuzzy' | 'none';
}

/**
 * Captura un ancla a partir de una selección sobre el documento.
 *
 * Se guarda contexto además de la cita porque una cita corta —«el usuario»,
 * «esto»— puede aparecer diez veces en el mismo documento, y sin contexto no
 * habría forma de saber a cuál se refería el comentario.
 */
export function createAnchor(content: string, start: number, end: number): Anchor | null {
  if (start < 0 || end > content.length || start >= end) return null;

  return {
    quote: content.slice(start, end),
    prefix: content.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: content.slice(end, Math.min(content.length, end + CONTEXT_LENGTH)),
    start,
    end,
  };
}

/**
 * Vuelve a situar un ancla en un contenido que puede haber cambiado.
 *
 * Se intenta por orden, de lo más fiable a lo menos:
 *
 * 1. **Exacta**: el texto sigue donde estaba. Es el caso mayoritario, porque
 *    editar el final de un documento no mueve lo de arriba.
 * 2. **Con contexto**: la cita con su prefijo y sufijo aparece una sola vez.
 * 3. **Solo la cita**: si aparece varias veces, gana la más cercana a donde
 *    estaba, que es lo más probable cuando el texto se ha desplazado.
 * 4. **Difusa**: absorbe correcciones menores dentro del fragmento.
 * 5. **Huérfana**: no se ha encontrado nada suficientemente parecido.
 */
export function reanchor(anchor: Anchor, content: string): AnchorResult {
  const exact = tryExact(anchor, content);
  if (exact) return exact;

  const withContext = tryContext(anchor, content);
  if (withContext) return withContext;

  const byQuote = tryQuote(anchor, content);
  if (byQuote) return byQuote;

  const fuzzy = tryFuzzy(anchor, content);
  if (fuzzy) return fuzzy;

  return { status: 'ORPHANED', start: null, end: null, strategy: 'none' };
}

function anchored(start: number, length: number, strategy: AnchorResult['strategy']): AnchorResult {
  return { status: 'ANCHORED', start, end: start + length, strategy };
}

function tryExact(anchor: Anchor, content: string): AnchorResult | null {
  if (content.slice(anchor.start, anchor.end) === anchor.quote) {
    return anchored(anchor.start, anchor.quote.length, 'exact');
  }
  return null;
}

/** La cita con su contexto: si aparece una sola vez, no hay ambigüedad posible. */
function tryContext(anchor: Anchor, content: string): AnchorResult | null {
  const needle = anchor.prefix + anchor.quote + anchor.suffix;
  const first = content.indexOf(needle);
  if (first === -1) return null;
  if (content.indexOf(needle, first + 1) !== -1) return null;

  return anchored(first + anchor.prefix.length, anchor.quote.length, 'context');
}

/**
 * Solo la cita. Si aparece varias veces gana la más cercana a la posición
 * original: cuando el texto se desplaza, se desplaza poco.
 */
function tryQuote(anchor: Anchor, content: string): AnchorResult | null {
  const positions: number[] = [];
  let from = content.indexOf(anchor.quote);
  while (from !== -1) {
    positions.push(from);
    from = content.indexOf(anchor.quote, from + 1);
  }
  if (positions.length === 0) return null;

  const closest = positions.reduce((best, position) =>
    Math.abs(position - anchor.start) < Math.abs(best - anchor.start) ? position : best,
  );
  return anchored(closest, anchor.quote.length, 'quote');
}

/**
 * Coincidencia difusa alrededor de la posición original.
 *
 * Solo se busca en una ventana en torno a donde estaba: un fragmento parecido
 * al otro extremo del documento casi nunca es el mismo, y aceptarlo es
 * justamente cómo un comentario acaba donde no debe.
 */
function tryFuzzy(anchor: Anchor, content: string): AnchorResult | null {
  const window = Math.max(anchor.quote.length * 4, 400);
  const from = Math.max(0, anchor.start - window);
  const to = Math.min(content.length, anchor.end + window);

  let best: { start: number; score: number } | null = null;

  for (let i = from; i + anchor.quote.length <= to; i += 1) {
    const candidate = content.slice(i, i + anchor.quote.length);
    // Descarta rápido lo que ni empieza parecido, que es casi todo.
    if (candidate[0] !== anchor.quote[0] && candidate[1] !== anchor.quote[1]) continue;

    const score = similarity(anchor.quote, candidate);
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
      best = { start: i, score };
    }
  }

  return best ? anchored(best.start, anchor.quote.length, 'fuzzy') : null;
}

/**
 * Similitud entre dos cadenas de la misma longitud, de 0 a 1.
 *
 * Se cuenta cuántas posiciones coinciden. Es más tosco que una distancia de
 * edición, pero para lo que hace falta —distinguir «una errata» de «otro
 * párrafo»— basta, y no requiere recorrer una matriz por cada posición del
 * documento.
 */
function similarity(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) matches += 1;
  }
  return matches / a.length;
}
