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
  /**
   * Falla ya al **contar** tokens, no al generar.
   *
   * Es otra fase y otro camino: contar es la primera vez que se habla con el
   * proveedor, y un fallo ahí ocurre antes de que exista invocación alguna. Sin
   * poder provocarlo, ese camino solo se recorría en producción.
   */
  readonly failCounting?: boolean;
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
  private script: FakeScript;

  constructor(script: FakeScript = {}) {
    this.script = script;
    this.id = script.id ?? AiProvider.ANTHROPIC;
    this.capabilities = {
      streaming: true,
      schemaOutput: true,
      webSearch: true,
      exactTokenCount: true,
      ...script.capabilities,
    };
  }

  /**
   * Cambia el guion sin volver a construirlo.
   *
   * Hace falta porque el registro se monta al arrancar la aplicación (T-36) y
   * un test no puede sustituirlo: lo que necesita es que **este** proveedor
   * falle ahora, o vaya despacio, para poder ejercitar reintentos y
   * cancelación por el camino real en lugar de simularlos.
   *
   * **Sustituye el guion entero**, no lo completa. Mezclarlo dejaba a un test
   * arrastrando lo que programó el anterior —un «falla la primera vez» que
   * sobrevivía a un «falla siempre»— y el fallo aparecía en el test equivocado.
   *
   * Las capacidades no se tocan: se declaran al construir y de ellas depende qué
   * funciones se ofrecen, así que cambiarlas a mitad dejaría a la aplicación
   * respondiendo dos cosas distintas sobre sí misma.
   */
  program(script: Omit<FakeScript, 'id' | 'capabilities'>): void {
    this.script = {
      ...script,
      ...(this.script.id !== undefined && { id: this.script.id }),
      ...(this.script.capabilities !== undefined && { capabilities: this.script.capabilities }),
    };
    this.attempts = 0;
    this.calls.length = 0;
  }

  verify(credential: Credential): Promise<void> {
    this.calls.push({ operation: 'verify', inputChars: 0 });
    /*
     * Coincidencia por contenido y no por igualdad: los DTO exigen una longitud
     * mínima a la clave, así que un test necesita una clave larga que además sea
     * reconociblemente mala.
     */
    const invalidas = this.script.invalidKeys ?? ['invalid'];
    if (invalidas.some((marca) => credential.apiKey.includes(marca))) {
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

    if (this.script.failCounting && this.script.failWith) {
      return Promise.reject(
        new ProviderError(
          this.script.failWith,
          `fallo de mentira al contar: ${this.script.failWith}`,
        ),
      );
    }

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
    /*
     * Sin guion, se responde **lo que el esquema pide**.
     *
     * Un `{}` obligaría a cada test y a cada recorrido a escribir a mano una
     * respuesta con la forma exacta de su esquema, y esa copia envejecería mal:
     * cambiar el esquema dejaría los guiones antiguos pasando por buenos algo
     * que ya no vale. Fabricándola aquí, el proveedor de mentira sigue siendo
     * útil para cualquier esquema que venga después sin saber nada de él.
     */
    const value = (this.script.object ?? stubFromSchema(request.schema)) as T;
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

/**
 * Un valor cualquiera que cumpla un esquema.
 *
 * Lo justo para que el otro lado tenga algo con la forma correcta: textos
 * reconocibles, la primera opción de cada enumerado y tantos elementos como
 * exija `minItems`. No pretende parecerse a una respuesta buena, sino a una
 * respuesta **válida**.
 */
export function stubFromSchema(schema: Readonly<Record<string, unknown>>, campo = ''): unknown {
  const enumerado: unknown[] = Array.isArray(schema['enum']) ? schema['enum'] : [];
  if (enumerado.length > 0) return enumerado[0];

  const tipos: unknown[] = Array.isArray(schema['type']) ? schema['type'] : [];
  const tipo = tipos.length > 0 ? tipos.find((t) => t !== 'null') : schema['type'];

  if (tipo === 'object') {
    const propiedades = (schema['properties'] ?? {}) as Record<
      string,
      Readonly<Record<string, unknown>>
    >;
    return Object.fromEntries(
      Object.entries(propiedades).map(([clave, sub]) => [clave, stubFromSchema(sub, clave)]),
    );
  }

  if (tipo === 'array') {
    const items = (schema['items'] ?? { type: 'string' }) as Readonly<Record<string, unknown>>;
    const cuantos = typeof schema['minItems'] === 'number' ? schema['minItems'] : 1;
    return Array.from({ length: cuantos }, (_, i) =>
      stubFromSchema(items, `${campo} ${String(i + 1)}`),
    );
  }

  if (tipo === 'number' || tipo === 'integer') return 1;
  if (tipo === 'boolean') return true;
  return campo === '' ? 'texto de mentira' : `${campo} de mentira`;
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
