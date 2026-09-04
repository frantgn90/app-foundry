import type { WebSearchOptions } from '@app-foundry/core';

/**
 * Los añadidos opcionales de una petición a Groq, y cómo se van soltando.
 *
 * Groq no publica en ninguna parte consultable qué admite cada modelo: que los
 * `compound` ejecutan sus herramientas solos, que los `gpt-oss` usan otro
 * interruptor de razonamiento, que unos aceptan esquema y otros no. Todo eso
 * estuvo un tiempo escrito aquí como reglas por familia, y cada una salió de un
 * fallo en producción, no de la documentación.
 *
 * Esto lo sustituye por algo que no envejece: **se pide lo mejor y, si lo
 * rechazan, se pide menos**. La única fuente de verdad pasa a ser lo que el
 * proveedor conteste, que es la que nunca se queda desactualizada.
 *
 * Cada eje es una escalera de opciones, de la más completa a la más pelada. Un
 * rechazo baja un peldaño del eje que lo provocó, no de los otros.
 */
export interface Ajustes {
  readonly [clave: string]: unknown;
}

/** En qué peldaño va cada eje. Cero es lo mejor que se sabe pedir. */
export interface Peldanos {
  readonly razonamiento: number;
  readonly busqueda: number;
}

export const MEJOR: Peldanos = { razonamiento: 0, busqueda: 0 };

/**
 * Cómo pedir que el razonamiento no venga en crudo.
 *
 * Groq lo exige con herramientas o con salida JSON: sin esto la respuesta vuelve
 * con un «Parsing failed» que no menciona en ningún momento cuál es el problema.
 * Se pide oculto porque en esas llamadas no se usa.
 */
const RAZONAMIENTO: readonly (() => Ajustes)[] = [
  () => ({ reasoning_format: 'hidden' }),
  () => ({ include_reasoning: false }),
  () => ({}),
];

/**
 * Cómo pedir que busque en la web.
 *
 * Primero la herramienta declarada, que es lo que entienden los `gpt-oss`.
 * Después la configuración propia de los sistemas `compound`, a los que no se
 * les declara nada sino que se les dice qué **pueden** usar. Y lo que importa de
 * esa lista es lo que deja fuera —ejecutar código, consultar Wolfram—: aquí se
 * viene a investigar un mercado, y una tarea que puede ejecutar código sin que
 * nadie lo haya pedido hace más de lo que dice.
 */
const BUSQUEDA: readonly ((opciones: WebSearchOptions) => Ajustes)[] = [
  (opciones) => ({
    tools: [{ type: 'browser_search' as const }],
    search_settings: {
      ...(opciones.allowedDomains && { include_domains: [...opciones.allowedDomains] }),
      ...(opciones.blockedDomains && { exclude_domains: [...opciones.blockedDomains] }),
    },
  }),
  () => ({ compound_custom: { tools: { enabled_tools: ['web_search', 'visit_website'] } } }),
  () => ({}),
];

export interface Contexto {
  /** Si hay esquema o búsqueda: es cuando el razonamiento no puede ir en crudo. */
  readonly controlarRazonamiento: boolean;
  readonly webSearch?: WebSearchOptions | undefined;
}

/** Los añadidos que tocan en estos peldaños. */
export function ajustesDe(peldanos: Peldanos, contexto: Contexto): Ajustes {
  const razonamiento = contexto.controlarRazonamiento
    ? (RAZONAMIENTO[Math.min(peldanos.razonamiento, RAZONAMIENTO.length - 1)] ?? (() => ({})))()
    : {};

  const busqueda = contexto.webSearch
    ? (BUSQUEDA[Math.min(peldanos.busqueda, BUSQUEDA.length - 1)] ?? (() => ({})))(
        contexto.webSearch,
      )
    : {};

  return { ...razonamiento, ...busqueda };
}

/**
 * El siguiente peldaño después de un rechazo, o `null` si no hay a dónde bajar.
 *
 * Se decide por lo que el proveedor **nombra** en su queja. Cuando no nombra
 * nada reconocible no se degrada: bajar un peldaño a ciegas convertiría
 * cualquier fallo —una clave mala, un modelo caído— en una ronda de reintentos
 * que acaban igual pero pidiendo menos.
 */
export function siguienteTras(mensaje: string, peldanos: Peldanos): Peldanos | null {
  const texto = mensaje.toLowerCase();

  if (/reasoning_format|include_reasoning/.test(texto)) {
    return peldanos.razonamiento + 1 < RAZONAMIENTO.length
      ? { ...peldanos, razonamiento: peldanos.razonamiento + 1 }
      : null;
  }

  if (/tools\[|browser_search|compound_custom|search_settings/.test(texto)) {
    return peldanos.busqueda + 1 < BUSQUEDA.length
      ? { ...peldanos, busqueda: peldanos.busqueda + 1 }
      : null;
  }

  return null;
}

/** Si en estos peldaños ya no se está pidiendo buscar nada. */
export function renunciaABuscar(peldanos: Peldanos): boolean {
  return peldanos.busqueda >= BUSQUEDA.length - 1;
}
