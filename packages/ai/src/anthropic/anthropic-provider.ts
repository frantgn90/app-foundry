import Anthropic from '@anthropic-ai/sdk';
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
  type WebSearchOptions,
  type WebSource,
} from '@app-foundry/core';

import { toAbortSignal } from '../errors.js';
import { translateAnthropicError } from './errors.js';

/** Inyectable para poder probar el adaptador sin red (RNF-901). */
export type AnthropicClientFactory = (credential: Credential) => Anthropic;

const CAPACIDADES: ProviderCapabilities = {
  streaming: true,
  schemaOutput: true,
  webSearch: true,
  exactTokenCount: true,
};

/**
 * Adaptador de Anthropic (T-23).
 *
 * Traduce el puerto a su SDK oficial y absorbe lo que tiene de particular, para
 * que ni el dominio ni la interfaz se enteren de con quién están hablando: la
 * salida con esquema va en `output_config.format`, la búsqueda web es una
 * herramienta que corre en su infraestructura, y un turno largo de esa búsqueda
 * puede pararse a mitad y hay que reanudarlo.
 *
 * **Lo que no hace, a propósito:** no fija configuración de razonamiento. Las
 * reglas de `thinking` varían de un modelo a otro, y el modelo lo elige el dueño
 * del workspace de un catálogo vivo (RF-1102): mandar una configuración que ese
 * modelo no admita sería un 400 en la cara del usuario. Omitirlo deja que cada
 * modelo aplique su comportamiento por defecto. El día que el puerto tenga
 * noción de esfuerzo, su sitio es aquí.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = AiProvider.ANTHROPIC;
  readonly capabilities = CAPACIDADES;

  constructor(
    private readonly createClient: AnthropicClientFactory = (credential) =>
      new Anthropic({ apiKey: credential.apiKey }),
  ) {}

  /** La llamada más barata que distingue una credencial buena de una mala (RF-1005). */
  async verify(credential: Credential): Promise<void> {
    try {
      await this.createClient(credential).models.list({ limit: 1 });
    } catch (error) {
      throw translateAnthropicError(error);
    }
  }

  async listModels(credential: Credential): Promise<readonly ModelInfo[]> {
    try {
      const modelos: ModelInfo[] = [];
      for await (const model of this.createClient(credential).models.list()) {
        modelos.push({
          id: model.id,
          displayName: model.display_name,
          /*
           * El catálogo admite nulo en ambos: un modelo sin ventana declarada no
           * puede gobernar el rechazo por tamaño (RF-1106), así que se queda en
           * cero y quien decide lo ve como «no lo sé» en vez de como «cabe todo».
           */
          contextWindow: model.max_input_tokens ?? 0,
          maxOutputTokens: model.max_tokens ?? 0,
        });
      }
      return modelos;
    } catch (error) {
      throw translateAnthropicError(error);
    }
  }

  async countTokens(request: TextRequest, credential: Credential): Promise<TokenCount> {
    try {
      const cuenta = await this.createClient(credential).messages.countTokens({
        model: request.model,
        system: request.system,
        messages: mensajesDe(request),
      });
      return { inputTokens: cuenta.input_tokens, exact: true };
    } catch (error) {
      throw translateAnthropicError(error);
    }
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
    const mensajes: Anthropic.MessageParam[] = [...mensajesDe(request)];

    let inputTokens = 0;
    let outputTokens = 0;
    let texto = '';

    try {
      /*
       * El bucle existe por `pause_turn`: un turno con búsqueda web puede
       * detenerse a mitad y hay que devolverle lo generado para que siga. Sin
       * esto la respuesta se corta sin error y sin aviso, que es la peor forma
       * de fallar: parece que terminó.
       */
      for (;;) {
        const stream = client.messages.stream(
          {
            model: request.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: mensajes,
            ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
            ...(request.webSearch && { tools: [webSearchTool(request.webSearch)] }),
          },
          signal ? { signal } : {},
        );

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            texto += event.delta.text;
            yield { type: 'delta', text: event.delta.text };
          }
        }

        const final = await stream.finalMessage();
        inputTokens += final.usage.input_tokens ?? 0;
        outputTokens += final.usage.output_tokens;

        const fuentes = sourcesOf(final);
        if (fuentes.length > 0) yield { type: 'sources', sources: fuentes };

        if (final.stop_reason === 'pause_turn') {
          mensajes.push({ role: 'assistant', content: final.content });
          continue;
        }
        if (final.stop_reason === 'refusal') {
          throw new ProviderError(ProviderErrorKind.CONTENT_FILTER, 'el proveedor se negó');
        }
        break;
      }
    } catch (error) {
      throw translateAnthropicError(error);
    }

    yield { type: 'usage', usage: { inputTokens, outputTokens } };
    yield schema ? { type: 'done', value: parseObject<T>(texto) } : { type: 'done' };
  }
}

function mensajesDe(request: TextRequest): Anthropic.MessageParam[] {
  return request.messages.map((message) => ({ role: message.role, content: message.content }));
}

function webSearchTool(options: WebSearchOptions): Anthropic.WebSearchTool20260209 {
  /*
   * Los dos listados se excluyen entre sí en la API. Si llegaran ambos, mandan
   * los permitidos: acotar de más es un fallo recuperable, y acotar de menos
   * deja pasar lo que alguien quiso excluir.
   */
  const dominios = options.allowedDomains
    ? { allowed_domains: [...options.allowedDomains] }
    : options.blockedDomains
      ? { blocked_domains: [...options.blockedDomains] }
      : {};

  return {
    type: 'web_search_20260209',
    name: 'web_search',
    ...(options.maxUses !== undefined && { max_uses: options.maxUses }),
    ...dominios,
  };
}

/**
 * Las fuentes citadas por la búsqueda.
 *
 * Un fallo de la búsqueda **no llega como excepción**: viene con HTTP 200 en un
 * bloque de resultado cuyo contenido es un objeto de error en vez de una lista.
 * Hay que ramificar antes de recorrerlo, y se trata como «sin fuentes» en lugar
 * de tirar la generación entera: el modelo responde igual, solo que sin
 * fundamento, y eso ya se le dice al usuario (RF-1305).
 */
function sourcesOf(message: Anthropic.Message): WebSource[] {
  const fuentes: WebSource[] = [];

  for (const block of message.content) {
    if (block.type !== 'web_search_tool_result') continue;
    if (!Array.isArray(block.content)) continue;

    for (const result of block.content) {
      fuentes.push({ url: result.url, title: result.title });
    }
  }
  return fuentes;
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
