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
import Groq from 'groq-sdk';
import type { ChatCompletionChunk } from 'groq-sdk/resources/chat/completions';

import { toAbortSignal } from '../errors.js';
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

  constructor(
    private readonly createClient: GroqClientFactory = (credential) =>
      new Groq({ apiKey: credential.apiKey }),
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

    /* Con herramientas o con esquema, el razonamiento no puede venir en crudo. */
    const sinRazonamientoEnCrudo = Boolean(schema ?? request.webSearch);

    let texto = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const fuentes: WebSource[] = [];

    try {
      const flujo = await client.chat.completions.create(
        {
          model: request.model,
          max_completion_tokens: request.maxOutputTokens,
          stream: true,
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          /*
           * Cómo se entrega el razonamiento, cuando hay herramientas o esquema
           * de por medio.
           *
           * Groq lo exige: con herramientas o con salida JSON, el razonamiento
           * **no puede ir en crudo** dentro del texto. Sin decir nada se usaba el
           * formato crudo, y la respuesta volvía con un «Parsing failed: the
           * model generated output that could not be parsed» que no dice en
           * ningún momento que el problema sea este.
           *
           * Se pide oculto porque aquí no se usa: lo que interesa de estas dos
           * llamadas es lo que el modelo concluye, no cómo llegó. En el asistente
           * de escritura, que no lleva ni herramientas ni esquema, se sigue
           * recibiendo en crudo y separándolo nosotros (`ReasoningSplitter`), que
           * es lo que permite enseñarlo plegado.
           *
           * Y los `gpt-oss` no admiten ese parámetro: tienen el suyo, que además
           * es mutuamente excluyente con el otro.
           */
          ...(sinRazonamientoEnCrudo &&
            (esGptOss(request.model)
              ? { include_reasoning: false }
              : { reasoning_format: 'hidden' as const })),
          ...(schema && {
            response_format: {
              type: 'json_schema' as const,
              json_schema: { name: 'respuesta', schema, strict: true },
            },
          }),
          /*
           * Hay dos formas de buscar en Groq, y confundirlas es un 400.
           *
           * Los modelos `compound` **ejecutan sus herramientas por su cuenta**:
           * se les pregunta y deciden solos si buscan. Declarárselas es un error
           * —«tools[0].type must be one of [function, mcp]»— porque su lista de
           * herramientas solo admite las que ejecuta el cliente. Los `gpt-oss`
           * son al revés: hay que pedirles la herramienta por su nombre.
           *
           * Los ajustes de búsqueda valen para los dos, así que van siempre.
           */
          ...(request.webSearch &&
            !buscaPorSuCuenta(request.model) && {
              tools: [{ type: 'browser_search' as const }],
            }),
          ...(request.webSearch && {
            search_settings: {
              ...(request.webSearch.allowedDomains && {
                include_domains: [...request.webSearch.allowedDomains],
              }),
              ...(request.webSearch.blockedDomains && {
                exclude_domains: [...request.webSearch.blockedDomains],
              }),
            },
          }),
        },
        signal ? { signal } : {},
      );

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
/**
 * Si el modelo se encarga solo de sus herramientas.
 *
 * Es una regla por familia y no un dato del catálogo porque Groq no publica esto
 * en ninguna parte consultable: está escrito en su documentación y punto. Al
 * menos aquí está en un sitio, con su motivo, en vez de repartida por el código.
 */
function buscaPorSuCuenta(model: string): boolean {
  return model.startsWith('groq/compound');
}

/** Los `gpt-oss` tienen su propio interruptor de razonamiento, no el común. */
function esGptOss(model: string): boolean {
  return model.includes('gpt-oss');
}

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
