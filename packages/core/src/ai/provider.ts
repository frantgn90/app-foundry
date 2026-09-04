import type { AiProvider, ProviderErrorKind } from './enums.js';

/**
 * El puerto por el que se habla con un modelo (TRD v2 §5, T-21, T-22).
 *
 * Vive en el dominio y no conoce la red: aquí se declara **qué** se le pide a un
 * proveedor, y `@app-foundry/ai` implementa el **cómo** con el SDK oficial de
 * cada uno (T-23). Esa frontera es lo que permite que el servidor MCP de la v3
 * invoque agentes reutilizando esto mismo en vez de encontrarse la IA encerrada
 * en un módulo HTTP (RD-1, RD-8).
 *
 * `core` no tiene dependencias, así que aquí no se puede nombrar nada de Node ni
 * del navegador. Es una restricción sana: obliga a que el contrato se exprese en
 * tipos propios y no en los de una plataforma concreta.
 */

/**
 * La clave del proveedor, ya descifrada.
 *
 * Nunca se registra, ni se serializa, ni se devuelve al cliente (RNF-602). Va en
 * su propio tipo para que aparezca a la vista en cada firma que la recibe: un
 * `string` suelto acaba en un log sin que nadie lo note.
 */
export interface Credential {
  readonly apiKey: string;
}

/** Lo que un proveedor sabe hacer (RF-1007). La interfaz se dibuja de aquí (RF-1008). */
export interface ProviderCapabilities {
  /** Devuelve la respuesta por partes conforme se genera. */
  readonly streaming: boolean;
  /** Garantiza que la respuesta cumple un esquema declarado. */
  readonly schemaOutput: boolean;
  /** Busca en la web desde su propia infraestructura (RF-1304). */
  readonly webSearch: boolean;
  /** Cuenta los tokens de una petición por API, en vez de obligar a aproximar (§10). */
  readonly exactTokenCount: boolean;
}

export type CapabilityName = keyof ProviderCapabilities;

/**
 * Un modelo del catálogo del proveedor (T-28).
 *
 * Sale de su API, no de una tabla nuestra: los precios no los publica nadie,
 * pero la ventana de contexto sí, y de ella depende poder rechazar a tiempo lo
 * que no cabe (RF-1106).
 */
export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
}

/**
 * Aviso de cancelación.
 *
 * Se declara aquí, en vez de usar `AbortSignal`, porque el dominio no conoce
 * ninguna plataforma. La forma es deliberadamente la de `AbortSignal`, de modo
 * que uno real encaje sin adaptador por medio.
 */
export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface PromptMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * Un esquema JSON.
 *
 * Se mantiene opaco a propósito: lo que importa de él no es su forma en
 * TypeScript sino que esté escrito en el subconjunto estricto que aceptan los
 * dos proveedores, y de eso se encarga su validador (T-24).
 */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Acotar la búsqueda, cuando el proveedor la ofrece. */
export interface WebSearchOptions {
  readonly maxUses?: number;
  readonly allowedDomains?: readonly string[];
  readonly blockedDomains?: readonly string[];
}

export interface WebSource {
  readonly url: string;
  readonly title: string;
}

export interface TextRequest {
  readonly model: string;
  /** El papel: quién es y qué se espera de él. Nunca contenido a comentar (RF-1614). */
  readonly system: string;
  /** El material. Va aparte del papel, y etiquetado como lo que es: datos. */
  readonly messages: readonly PromptMessage[];
  /** Techo de generación. Es también la mitad de la estimación previa (§10). */
  readonly maxOutputTokens: number;
  readonly webSearch?: WebSearchOptions;
  readonly signal?: CancellationSignal;
}

export interface ObjectRequest<T> extends TextRequest {
  readonly schema: JsonSchema;
  /** Solo sirve para llevar el tipo; no existe en tiempo de ejecución. */
  readonly __result?: T;
}

/** Lo que un modelo consumió. Entrada y salida separadas siempre (T-29). */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface TokenCount {
  readonly inputTokens: number;
  /** Falso cuando el proveedor no cuenta por API y hubo que aproximar (§10). */
  readonly exact: boolean;
}

/**
 * Lo que llega mientras se genera.
 *
 * No hay evento de error: un fallo **se lanza** desde el iterador, que es como
 * se propaga cualquier otro en el lenguaje. Un error como evento se puede
 * ignorar sin querer y deja la operación pareciendo un éxito vacío.
 */
/**
 * Algo que el proveedor **no ha podido hacer**, y que cambia lo que vale la
 * respuesta.
 *
 * No es un error: la generación sigue y termina bien. Es una merma, y quien la
 * enseñe tiene que poder decirla. Sin esto, una respuesta escrita sin buscar es
 * indistinguible de una escrita habiendo buscado, que es exactamente lo que
 * RF-1305 prohíbe.
 */
export const GenerationLimit = {
  /** Se pidió buscar en la web y el modelo no admite ninguna forma de hacerlo. */
  NO_WEB_SEARCH: 'NO_WEB_SEARCH',
} as const;
export type GenerationLimit = (typeof GenerationLimit)[keyof typeof GenerationLimit];

export type GenerationEvent<T = never> =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'limit'; readonly limit: GenerationLimit }
  | { readonly type: 'partial'; readonly value: unknown }
  | { readonly type: 'sources'; readonly sources: readonly WebSource[] }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'done'; readonly value?: T };

/** Fallo de un proveedor, ya traducido a la taxonomía común. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Lo que tiene que saber hacer un proveedor para entrar en el producto.
 *
 * Cuatro operaciones y ni una más. En particular **no** hay bucle de
 * herramientas: un agente produce texto y nada más (RD-9), así que un contrato
 * que ejecutara herramientas se diseñaría sin ningún consumidor.
 */
export interface LlmProvider {
  readonly id: AiProvider;
  readonly capabilities: ProviderCapabilities;

  /** Comprueba que la credencial sirve, con la llamada más barata posible (RF-1005). */
  verify(credential: Credential): Promise<void>;

  /** El catálogo vivo del proveedor (RF-1007). */
  listModels(credential: Credential): Promise<readonly ModelInfo[]>;

  /** Cuántos tokens de entrada supone esta petición. Exacto o aproximado al alza (§10). */
  countTokens(request: TextRequest, credential: Credential): Promise<TokenCount>;

  streamText(request: TextRequest, credential: Credential): AsyncIterable<GenerationEvent>;

  streamObject<T>(
    request: ObjectRequest<T>,
    credential: Credential,
  ): AsyncIterable<GenerationEvent<T>>;
}
