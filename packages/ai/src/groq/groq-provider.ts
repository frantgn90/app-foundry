import {
  AiProvider,
  type Credential,
  type GenerationEvent,
  GenerationLimit,
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
import Groq from 'groq-sdk';
import type { ChatCompletionChunk } from 'groq-sdk/resources/chat/completions';

import { toAbortSignal } from '../errors.js';
import { ajustesDe, MEJOR, type Peldanos, renunciaABuscar, siguienteTras } from './tuning.js';
import { translateGroqError } from './errors.js';

export type GroqClientFactory = (credential: Credential) => Groq;

const CAPACIDADES: ProviderCapabilities = {
  streaming: true,
  schemaOutput: true,
  webSearch: true,
  /* No expone contador de tokens: hay que aproximar, siempre al alza (§10). */
  exactTokenCount: false,
};

/**
 * Adaptador de Groq (T-23).
 *
 * Su API tiene forma de la de OpenAI, así que casi todo lo particular está en
 * tres sitios: la salida con esquema va en `response_format.json_schema` con
 * `strict`, que es **decodificación restringida** —el modelo no puede
 * desviarse del esquema, a cambio de que todos los campos sean obligatorios
 * (T-24)—; la búsqueda web es una herramienta preconstruida que corre en su
 * infraestructura; y el consumo llega en el último trozo del flujo.
 */
export class GroqProvider implements LlmProvider {
  readonly id = AiProvider.GROQ;
  readonly capabilities = CAPACIDADES;

  /**
   * Lo que se ha aprendido de cada modelo a fuerza de que rechace cosas.
   *
   * Vive en memoria y por proceso a propósito: es una caché de conveniencia, no
   * un dato del producto. Perderla al reiniciar solo cuesta un tanteo más; y que
   * se pierda es justo lo que hace que un cambio en el proveedor se aprenda
   * solo, sin que nadie tenga que ir a invalidar nada.
   */
  private readonly aprendido = new Map<string, Peldanos>();

  constructor(
    private readonly createClient: GroqClientFactory = (credential) =>
      new Groq({
        apiKey: credential.apiKey,
        /*
         * La última versión de los sistemas `compound`, que es donde salen
         * primero sus herramientas nuevas. Sin esta cabecera se sirve una
         * versión fijada, más estable pero congelada.
         */
        defaultHeaders: { 'Groq-Model-Version': 'latest' },
      }),
  ) {}

  async verify(credential: Credential): Promise<void> {
    try {
      await this.createClient(credential).models.list();
    } catch (error) {
      throw translateGroqError(error);
    }
  }

  async listModels(credential: Credential): Promise<readonly ModelInfo[]> {
    try {
      const respuesta = await this.createClient(credential).models.list();
      return respuesta.data.map((model) => ({
        id: model.id,
        displayName: model.id,
        /*
         * El SDK no declara la ventana de contexto aunque la API la devuelva, así
         * que se lee del objeto sin tipar. Cero significa **no lo sé**, no «cabe
         * todo»: quien decida el rechazo por tamaño (RF-1106) tiene que tratarlo
         * como desconocido en vez de como infinito.
         */
        contextWindow: numeroDe(model, 'context_window'),
        maxOutputTokens: numeroDe(model, 'max_completion_tokens'),
      }));
    } catch (error) {
      throw translateGroqError(error);
    }
  }

  /**
   * Sin contador por API, se aproxima en local y **siempre por encima**.
   *
   * La cifra solo se usa para el techo de la estimación previa (§10), donde
   * pasarse es incómodo y quedarse corto deja arrancar algo que no cabe en el
   * cupo. El factor está pendiente de calibrar contra el contador exacto de
   * Anthropic sobre documentos representativos (TRD v2 §21).
   */
  countTokens(request: TextRequest, _credential: Credential): Promise<TokenCount> {
    return Promise.resolve({ inputTokens: approximateTokens(request), exact: false });
  }

  streamText(request: TextRequest, credential: Credential): AsyncIterable<GenerationEvent> {
    return this.generate(request, credential);
  }

  streamObject<T>(
    request: ObjectRequest<T>,
    credential: Credential,
  ): AsyncIterable<GenerationEvent<T>> {
    return this.generate<T>(request, credential, request.schema);
  }

  private async *generate<T = never>(
    request: TextRequest,
    credential: Credential,
    schema?: Readonly<Record<string, unknown>>,
  ): AsyncGenerator<GenerationEvent<T>> {
    const client = this.createClient(credential);
    const signal = toAbortSignal(request.signal);

    const contexto = {
      controlarRazonamiento: Boolean(schema ?? request.webSearch),
      webSearch: request.webSearch,
    };

    let texto = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const fuentes: WebSource[] = [];

    /*
     * Se pide lo mejor y, si lo rechazan, se pide menos.
     *
     * Lo que admite cada modelo no se puede consultar en ninguna parte, así que
     * la única fuente de verdad es lo que conteste. Lo que funcionó se recuerda
     * por modelo: así solo la primera llamada de cada proceso paga el tanteo, y
     * el día que Groq cambie algo se vuelve a aprender solo.
     */
    let peldanos = this.aprendido.get(request.model) ?? MEJOR;
    let flujo;

    try {
      for (;;) {
        try {
          flujo = await client.chat.completions.create(
            {
              model: request.model,
              max_completion_tokens: request.maxOutputTokens,
              stream: true,
              messages: [
                { role: 'system', content: request.system },
                ...request.messages.map((m) => ({ role: m.role, content: m.content })),
              ],
              ...(schema && {
                response_format: {
                  type: 'json_schema' as const,
                  json_schema: { name: 'respuesta', schema, strict: true },
                },
              }),
              ...ajustesDe(peldanos, contexto),
            },
            signal ? { signal } : {},
          );
          break;
        } catch (error) {
          /*
           * El esquema **no** se degrada aquí: quien lo pidió espera un objeto, y
           * devolverle prosa en silencio sería peor que fallar. Esa decisión es
           * de quien llama, que sabe si tiene otra forma de pedirlo.
           */
          const siguiente = error instanceof Error ? siguienteTras(error.message, peldanos) : null;
          if (!siguiente) throw error;
          peldanos = siguiente;
        }
      }

      this.aprendido.set(request.model, peldanos);

      /*
       * Si se pidió buscar y se acabó pidiendo nada, la respuesta no está
       * fundamentada aunque la llamada haya salido bien. Se dice, porque una
       * respuesta escrita sin buscar es indistinguible de una escrita habiendo
       * buscado (RF-1305).
       */
      if (request.webSearch && renunciaABuscar(peldanos)) {
        yield { type: 'limit', limit: GenerationLimit.NO_WEB_SEARCH };
      }

      for await (const chunk of flujo) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          texto += delta.content;
          yield { type: 'delta', text: delta.content };
        }

        for (const fuente of sourcesOf(delta?.executed_tools)) fuentes.push(fuente);

        /* El consumo llega en el último trozo, no en un evento aparte. */
        const usage = chunk.x_groq?.usage;
        if (usage) {
          inputTokens = usage.prompt_tokens ?? 0;
          outputTokens = usage.completion_tokens ?? 0;
        }
      }
    } catch (error) {
      throw translateGroqError(error);
    }

    if (fuentes.length > 0) yield { type: 'sources', sources: fuentes };
    yield { type: 'usage', usage: { inputTokens, outputTokens } };
    yield schema ? { type: 'done', value: parseObject<T>(texto) } : { type: 'done' };
  }
}

/**
 * Aproximación al alza: tres caracteres por token más un margen por mensaje.
 *
 * Un tokenizador real da entre tres y cuatro caracteres por token en castellano,
 * y el markdown sube la cuenta. Se elige el extremo caro a propósito: esta cifra
 * gobierna un techo, y un techo que se queda corto no es un techo.
 */
export function approximateTokens(request: TextRequest): number {
  const partes = [request.system, ...request.messages.map((m) => m.content)];
  return partes.reduce((total, parte) => total + Math.ceil(parte.length / 3) + 8, 0);
}

/**
 * Las fuentes que citó la búsqueda.
 *
 * En su tipado, tanto la url como el título son opcionales: un resultado sin
 * url no sirve de fuente y se descarta, y uno sin título se muestra por su
 * dirección antes que con una etiqueta inventada.
 */
type HerramientaEjecutada = ChatCompletionChunk.Choice.Delta.ExecutedTool;

function sourcesOf(executed: readonly HerramientaEjecutada[] | undefined): WebSource[] {
  if (!executed) return [];

  const fuentes: WebSource[] = [];
  for (const herramienta of executed) {
    for (const resultado of herramienta.search_results?.results ?? []) {
      if (!resultado.url) continue;
      fuentes.push({ url: resultado.url, title: resultado.title ?? resultado.url });
    }
  }
  return fuentes;
}

function numeroDe(objeto: object, campo: string): number {
  const valor = (objeto as Record<string, unknown>)[campo];
  return typeof valor === 'number' ? valor : 0;
}

function parseObject<T>(texto: string): T {
  try {
    return JSON.parse(texto) as T;
  } catch (error) {
    throw new ProviderError(
      ProviderErrorKind.SCHEMA,
      'la respuesta no era JSON válido pese a pedirse con esquema',
      error,
    );
  }
}
