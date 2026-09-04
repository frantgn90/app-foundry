/**
 * Separa lo que el modelo **piensa** de lo que el modelo **responde**.
 *
 * Muchos modelos de razonamiento escriben su deliberación en el mismo flujo de
 * texto, envuelta en `<think>…</think>`: Qwen lo hace, DeepSeek-R1 lo hace, y la
 * lista crece. Eso no es la respuesta, es el camino hasta ella, y no puede
 * acabar dentro del documento de nadie.
 *
 * Se separa **en el servidor** y no al pintarlo. La diferencia importa: lo que
 * se acepta se escribe en el `VISION.md`, así que dejar la limpieza para la
 * interfaz significaría que cualquier otro consumidor —un agente escribiendo un
 * comentario, el MCP de la v3— se lo comería igual.
 *
 * Y se guarda en vez de tirarse: entender por qué el modelo propuso lo que
 * propuso es a veces más útil que la propuesta.
 */

/**
 * Las etiquetas que se reconocen, y **solo** estas.
 *
 * Es una lista corta a propósito. Cuanto más liberal fuera el reconocimiento,
 * más fácil sería que un documento que hable de etiquetas HTML perdiera un
 * trozo por el camino, y un texto que desaparece sin dejar rastro es mucho peor
 * que un razonamiento que se cuela.
 */
const APERTURAS = ['<think>', '<thinking>'] as const;
const CIERRES = ['</think>', '</thinking>'] as const;

export interface SplitText {
  /** Lo que va al documento. */
  readonly text: string;
  /** Lo que el modelo se dijo a sí mismo por el camino. */
  readonly reasoning: string;
}

const NADA: SplitText = { text: '', reasoning: '' };

/**
 * Reparte un flujo de texto en respuesta y razonamiento, trozo a trozo.
 *
 * Es incremental porque el texto llega en partes y una etiqueta se parte por
 * donde quiera: `<thi` en un trozo y `nk>` en el siguiente es lo normal, no lo
 * raro. Por eso se retiene el final de cada trozo mientras pueda ser el
 * principio de una etiqueta, y por eso hace falta `flush`: lo retenido que al
 * final no era una etiqueta es texto, y tiene que salir.
 */
export class ReasoningSplitter {
  private dentro = false;
  /** Lo retenido: puede ser el principio de una etiqueta, o texto corriente. */
  private pendiente = '';

  push(chunk: string): SplitText {
    if (chunk === '') return NADA;

    let resto = this.pendiente + chunk;
    this.pendiente = '';

    let text = '';
    let reasoning = '';

    for (;;) {
      const etiquetas = this.dentro ? CIERRES : APERTURAS;
      const encontrada = primeraDe(resto, etiquetas);

      if (encontrada) {
        const antes = resto.slice(0, encontrada.indice);
        if (this.dentro) reasoning += antes;
        else text += antes;

        resto = resto.slice(encontrada.indice + encontrada.etiqueta.length);
        this.dentro = !this.dentro;
        continue;
      }

      /*
       * Sin etiqueta entera: se suelta todo menos lo que podría ser el principio
       * de una. Soltarlo también dejaría escapar un `<think>` partido en dos
       * trozos, que es justo el caso que hay que cubrir.
       */
      const retenido = colaQuePodriaSerEtiqueta(resto, etiquetas);
      const soltar = resto.slice(0, resto.length - retenido);
      if (this.dentro) reasoning += soltar;
      else text += soltar;

      this.pendiente = resto.slice(resto.length - retenido);
      break;
    }

    return { text, reasoning };
  }

  /**
   * Cierra el reparto y suelta lo retenido.
   *
   * Lo que quedaba a medias no era una etiqueta —el flujo se acabó—, así que es
   * texto. Y si el bloque de razonamiento se quedó abierto, lo que hay dentro
   * sigue siendo razonamiento: pasa cuando el modelo se queda sin tokens
   * pensando, y meterlo en el documento sería lo peor que se puede hacer con
   * ello.
   */
  flush(): SplitText {
    const resto = this.pendiente;
    this.pendiente = '';
    if (resto === '') return NADA;
    return this.dentro ? { text: '', reasoning: resto } : { text: resto, reasoning: '' };
  }

  /** Si el flujo terminó con un bloque de razonamiento sin cerrar. */
  get unterminated(): boolean {
    return this.dentro;
  }
}

/**
 * Separa un texto completo, para lo que no llega en partes.
 *
 * Misma regla, un solo paso: útil para lo que se recibe de golpe y para poder
 * comprobar el comportamiento sin simular un flujo.
 */
export function splitReasoning(texto: string): SplitText {
  const separador = new ReasoningSplitter();
  const primero = separador.push(texto);
  const ultimo = separador.flush();
  return {
    text: primero.text + ultimo.text,
    reasoning: primero.reasoning + ultimo.reasoning,
  };
}

function primeraDe(
  texto: string,
  etiquetas: readonly string[],
): { indice: number; etiqueta: string } | null {
  let mejor: { indice: number; etiqueta: string } | null = null;

  for (const etiqueta of etiquetas) {
    const indice = texto.toLowerCase().indexOf(etiqueta);
    if (indice === -1) continue;
    /*
     * La más temprana, y a igualdad la más larga: `<thinking>` empieza donde
     * empezaría `<think>` si se comparara solo el prefijo, y quedarse con la
     * corta dejaría un `ing>` suelto en el texto.
     */
    if (
      !mejor ||
      indice < mejor.indice ||
      (indice === mejor.indice && etiqueta.length > mejor.etiqueta.length)
    ) {
      mejor = { indice, etiqueta };
    }
  }

  return mejor;
}

/** Cuántos caracteres del final podrían ser el principio de una etiqueta. */
function colaQuePodriaSerEtiqueta(texto: string, etiquetas: readonly string[]): number {
  const maximo = Math.min(texto.length, Math.max(...etiquetas.map((e) => e.length)) - 1);

  for (let largo = maximo; largo > 0; largo -= 1) {
    const cola = texto.slice(texto.length - largo).toLowerCase();
    if (etiquetas.some((etiqueta) => etiqueta.startsWith(cola))) return largo;
  }
  return 0;
}
