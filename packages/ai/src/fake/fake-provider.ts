import {
  AiProvider,
  type Credential,
  type GenerationEvent,
  type LlmProvider,
  type ModelInfo,
  type ObjectRequest,
  ProviderError,
  ProviderErrorKind,
  type ProviderCapabilities,
  type TextRequest,
  type TokenCount,
  type WebSource,
} from '@app-foundry/core';

/**
 * Un proveedor que no llama a nadie (T-36, RNF-901).
 *
 * Existe para que la suite entera pueda ejercitar el camino real —selección de
 * proveedor, reserva de cupo, streaming, reintentos, cancelación— sin gastar la
 * cuota de nadie y sin depender de que un tercero esté en pie.
 *
 * **Suplanta a un proveedor real en vez de ser uno nuevo.** No se añade un valor
 * al enum del dominio: lo que se cambia por configuración es el registro que
 * resuelve un identificador a su adaptador (T-36). Así la base de datos, la API
 * y la interfaz recorren exactamente el mismo código que en producción, que es
 * la única forma de que un recorrido de extremo a extremo demuestre algo.
 */
export interface FakeScript {
  /** A quién suplanta. Por defecto, Anthropic. */
  readonly id?: AiProvider;
  /** Capacidades a simular: sirve para probar la degradación sin búsqueda web. */
  readonly capabilities?: Partial<ProviderCapabilities>;
  /** Lo que devuelve `streamText`, troceado en deltas. */
  readonly text?: string;
  /** Lo que devuelve `streamObject`. */
  readonly object?: unknown;
  /** Fuentes que acompañan a la respuesta cuando se pide búsqueda web. */
  readonly sources?: readonly WebSource[];
  /** El catálogo que devuelve `listModels`. */
  readonly models?: readonly ModelInfo[];
  /** Falla siempre así, en vez de responder. */
  readonly failWith?: ProviderErrorKind;
  /** Falla solo los primeros intentos y luego responde: para probar reintentos. */
  readonly failTimes?: number;
  /** Espera entre deltas. Sirve para cancelar a mitad de una generación. */
  readonly delayMs?: number;
  /** Claves que se consideran inválidas al verificar. */
  readonly invalidKeys?: readonly string[];
}

export interface FakeCall {
  readonly operation: 'verify' | 'listModels' | 'countTokens' | 'streamText' | 'streamObject';
  readonly model?: string;
  readonly inputChars: number;
}

const MODELOS: readonly ModelInfo[] = [
  { id: 'fake-large', displayName: 'Fake Large', contextWindow: 200_000, maxOutputTokens: 8_000 },
  { id: 'fake-small', displayName: 'Fake Small', contextWindow: 32_000, maxOutputTokens: 4_000 },
];

/**
 * Cuenta determinista: cuatro caracteres por token, redondeando hacia arriba.
 *
 * No pretende parecerse a ningún tokenizador real. Lo que necesita un test es
 * que dos ejecuciones den el mismo número, no que el número sea cierto.
 */
export function fakeTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export class FakeProvider implements LlmProvider {
  readonly id: AiProvider;
  readonly capabilities: ProviderCapabilities;

  /** Lo que se le ha pedido, en orden. Para que un test pueda comprobarlo. */
  readonly calls: FakeCall[] = [];

  private attempts = 0;

  constructor(private readonly script: FakeScript = {}) {
    this.id = script.id ?? AiProvider.ANTHROPIC;
    this.capabilities = {
      streaming: true,
      schemaOutput: true,
      webSearch: true,
      exactTokenCount: true,
      ...script.capabilities,
    };
  }

  verify(credential: Credential): Promise<void> {
    this.calls.push({ operation: 'verify', inputChars: 0 });
    const invalidas = this.script.invalidKeys ?? ['invalid'];
    if (invalidas.includes(credential.apiKey)) {
      return Promise.reject(new ProviderError(ProviderErrorKind.AUTH, 'credencial rechazada'));
    }
    return Promise.resolve();
  }

  listModels(): Promise<readonly ModelInfo[]> {
    this.calls.push({ operation: 'listModels', inputChars: 0 });
    return Promise.resolve(this.script.models ?? MODELOS);
  }

  countTokens(request: TextRequest): Promise<TokenCount> {
    const inputChars = charsOf(request);
    this.calls.push({ operation: 'countTokens', model: request.model, inputChars });
    return Promise.resolve({
      inputTokens: fakeTokenCount(textOf(request)),
      exact: this.capabilities.exactTokenCount,
    });
  }

  streamText(request: TextRequest): AsyncIterable<GenerationEvent> {
    this.calls.push({
      operation: 'streamText',
      model: request.model,
      inputChars: charsOf(request),
    });
    return this.generate(request, this.script.text ?? 'texto de mentira');
  }

  streamObject<T>(request: ObjectRequest<T>): AsyncIterable<GenerationEvent<T>> {
    this.calls.push({
      operation: 'streamObject',
      model: request.model,
      inputChars: charsOf(request),
    });
    const value = (this.script.object ?? {}) as T;
    return this.generate<T>(request, JSON.stringify(value), value);
  }

  private async *generate<T = never>(
    request: TextRequest,
    text: string,
    value?: T,
  ): AsyncGenerator<GenerationEvent<T>> {
    this.attempts += 1;
    this.failIfScripted();

    if (request.webSearch && this.capabilities.webSearch) {
      yield { type: 'sources', sources: this.script.sources ?? [] };
    }

    /*
     * Se trocea por palabras: es suficiente para que un consumidor tenga que
     * acumular deltas de verdad, en vez de recibir la respuesta entera de una
     * vez y no enterarse de que estaba tratando con un flujo.
     */
    for (const trozo of trocear(text)) {
      this.throwIfCancelled(request);
      if (this.script.delayMs) await esperar(this.script.delayMs);
      yield { type: 'delta', text: trozo };
    }

    this.throwIfCancelled(request);

    yield {
      type: 'usage',
      usage: { inputTokens: fakeTokenCount(textOf(request)), outputTokens: fakeTokenCount(text) },
    };
    yield value === undefined ? { type: 'done' } : { type: 'done', value };
  }

  private failIfScripted(): void {
    const { failWith, failTimes } = this.script;
    if (!failWith) return;
    if (failTimes !== undefined && this.attempts > failTimes) return;
    throw new ProviderError(failWith, `fallo de mentira: ${failWith}`);
  }

  private throwIfCancelled(request: TextRequest): void {
    if (request.signal?.aborted) {
      throw new ProviderError(ProviderErrorKind.CANCELLED, 'cancelado');
    }
  }
}

function textOf(request: TextRequest): string {
  return [request.system, ...request.messages.map((m) => m.content)].join('\n');
}

function charsOf(request: TextRequest): number {
  return textOf(request).length;
}

function trocear(text: string): string[] {
  const palabras = text.split(' ');
  return palabras.map((palabra, indice) => (indice === 0 ? palabra : ` ${palabra}`));
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
