import { ProviderErrorKind } from '@app-foundry/core';
import type { GenerationEvent, TextRequest } from '@app-foundry/core';
import GroqSdk from 'groq-sdk';
import type Groq from 'groq-sdk';
import { describe, expect, it } from 'vitest';

import { approximateTokens, GroqProvider } from '../src/groq/groq-provider.js';

interface Chunk {
  readonly content?: string;
  readonly executedTools?: unknown[];
  readonly usage?: { prompt_tokens: number; completion_tokens: number };
}

interface Stub {
  readonly client: Groq;
  readonly params: Record<string, unknown>[];
  readonly options: Record<string, unknown>[];
}

function stub(chunks: Chunk[], modelos: unknown[] = []): Stub {
  const params: Record<string, unknown>[] = [];
  const options: Record<string, unknown>[] = [];

  const client = {
    models: { list: () => Promise.resolve({ data: modelos }) },
    chat: {
      completions: {
        create: (p: Record<string, unknown>, o: Record<string, unknown>) => {
          params.push(p);
          options.push(o);
          return Promise.resolve({
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) {
                yield await Promise.resolve({
                  choices: [
                    {
                      delta: {
                        ...(chunk.content !== undefined && { content: chunk.content }),
                        ...(chunk.executedTools && { executed_tools: chunk.executedTools }),
                      },
                    },
                  ],
                  ...(chunk.usage && { x_groq: { usage: chunk.usage } }),
                });
              }
            },
          });
        },
      },
    },
  };

  return { client: client as unknown as Groq, params, options };
}

const peticion = (extra: Partial<TextRequest> = {}): TextRequest => ({
  model: 'llama-3.3-70b-versatile',
  system: 'eres un product owner',
  messages: [{ role: 'user', content: 'revisa esto' }],
  maxOutputTokens: 2_000,
  ...extra,
});

async function recoger<T>(flujo: AsyncIterable<GenerationEvent<T>>): Promise<GenerationEvent<T>[]> {
  const eventos: GenerationEvent<T>[] = [];
  for await (const evento of flujo) eventos.push(evento);
  return eventos;
}

const credencial = { apiKey: 'gsk-de-mentira' };

describe('el adaptador de Groq', () => {
  it('el papel va como mensaje de sistema, aparte del material', async () => {
    const { client, params } = stub([{ content: 'hola' }]);
    const proveedor = new GroqProvider(() => client);

    await recoger(proveedor.streamText(peticion(), credencial));

    expect(params[0]?.['messages']).toEqual([
      { role: 'system', content: 'eres un product owner' },
      { role: 'user', content: 'revisa esto' },
    ]);
    expect(params[0]?.['max_completion_tokens']).toBe(2_000);
  });

  it('entrega el texto por partes y recoge el consumo del último trozo', async () => {
    const { client } = stub([
      { content: 'una idea' },
      { content: ' buena' },
      { usage: { prompt_tokens: 300, completion_tokens: 40 } },
    ]);
    const proveedor = new GroqProvider(() => client);

    const eventos = await recoger(proveedor.streamText(peticion(), credencial));

    expect(
      eventos
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('una idea buena');
    expect(eventos.find((e) => e.type === 'usage')?.usage).toEqual({
      inputTokens: 300,
      outputTokens: 40,
    });
  });

  /*
   * La diferencia que obliga a escribir los esquemas en el subconjunto estricto
   * (T-24): aquí `strict` es decodificación restringida, y el modelo no puede
   * desviarse a cambio de que ningún campo sea opcional.
   */
  it('pide la salida con esquema en decodificación restringida', async () => {
    const { client, params } = stub([{ content: '{"ideas":[]}' }]);
    const proveedor = new GroqProvider(() => client);
    const schema = { type: 'object', additionalProperties: false, required: [], properties: {} };

    const eventos = await recoger(proveedor.streamObject({ ...peticion(), schema }, credencial));

    expect(params[0]?.['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'respuesta', schema, strict: true },
    });
    expect(eventos.at(-1)).toEqual({ type: 'done', value: { ideas: [] } });
  });

  describe('la búsqueda web', () => {
    it('va como herramienta preconstruida, con sus dominios aparte', async () => {
      const { client, params } = stub([{ content: 'hola' }]);
      const proveedor = new GroqProvider(() => client);

      await recoger(
        proveedor.streamText(
          peticion({ webSearch: { allowedDomains: ['example.com'] } }),
          credencial,
        ),
      );

      expect(params[0]?.['tools']).toEqual([{ type: 'browser_search' }]);
      expect(params[0]?.['search_settings']).toEqual({ include_domains: ['example.com'] });
    });

    /*
     * Los modelos `compound` ejecutan sus herramientas por su cuenta y su lista
     * solo admite las del cliente: declararles la búsqueda es un 400.
     */
    it('a los que buscan por su cuenta no se les declara nada', async () => {
      const { client, params } = stub([{ content: 'hola' }]);
      const proveedor = new GroqProvider(() => client);

      await recoger(
        proveedor.streamText(
          { ...peticion(), model: 'groq/compound', webSearch: { maxUses: 3 } },
          credencial,
        ),
      );

      expect(params[0]?.['tools']).toBeUndefined();
      /* Pero los ajustes de búsqueda sí valen para ellos. */
      expect(params[0]).toHaveProperty('search_settings');
    });

    it('recoge las fuentes de las herramientas ejecutadas', async () => {
      const { client } = stub([
        {
          content: 'según esto',
          executedTools: [
            {
              search_results: {
                results: [
                  { url: 'https://a.example', title: 'A' },
                  { url: 'https://b.example' },
                  { title: 'sin dirección' },
                ],
              },
            },
          ],
        },
      ]);
      const proveedor = new GroqProvider(() => client);

      const eventos = await recoger(proveedor.streamText(peticion({ webSearch: {} }), credencial));

      /* Sin url no es una fuente; sin título se muestra su dirección. */
      expect(eventos.find((e) => e.type === 'sources')?.sources).toEqual([
        { url: 'https://a.example', title: 'A' },
        { url: 'https://b.example', title: 'https://b.example' },
      ]);
    });
  });

  /*
   * Groq lo exige: con herramientas o con salida JSON el razonamiento no puede
   * ir en crudo dentro del texto. Sin decirlo, la respuesta volvía con un
   * «Parsing failed» que no menciona en ningún momento que el problema sea este.
   */
  describe('el razonamiento cuando hay herramientas o esquema', () => {
    it('se pide oculto, porque en esas dos llamadas no se usa', async () => {
      const { client, params } = stub([{ content: 'hola' }]);
      const proveedor = new GroqProvider(() => client);

      await recoger(proveedor.streamText({ ...peticion(), webSearch: { maxUses: 2 } }, credencial));

      expect(params[0]?.['reasoning_format']).toBe('hidden');
    });

    /* Los `gpt-oss` no admiten ese parámetro: tienen el suyo, y son excluyentes. */
    it('los gpt-oss llevan el suyo', async () => {
      const { client, params } = stub([{ content: 'hola' }]);
      const proveedor = new GroqProvider(() => client);

      await recoger(
        proveedor.streamText(
          { ...peticion(), model: 'openai/gpt-oss-120b', webSearch: { maxUses: 2 } },
          credencial,
        ),
      );

      expect(params[0]?.['include_reasoning']).toBe(false);
      expect(params[0]?.['reasoning_format']).toBeUndefined();
    });

    /*
     * Y a los que se gestionan solos no se les pide **nada**: pedirles el formato
     * de razonamiento es otro 400, igual que declararles herramientas. Con ellos
     * se habla y ya está.
     */
    it('a los que se gestionan solos no se les pide ningún formato', async () => {
      const { client, params } = stub([{ content: 'hola' }]);
      const proveedor = new GroqProvider(() => client);

      await recoger(
        proveedor.streamText(
          { ...peticion(), model: 'groq/compound-mini', webSearch: { maxUses: 2 } },
          credencial,
        ),
      );

      expect(params[0]?.['reasoning_format']).toBeUndefined();
      expect(params[0]?.['include_reasoning']).toBeUndefined();
      expect(params[0]?.['tools']).toBeUndefined();
    });

    /*
     * Sin herramientas ni esquema no se toca: es lo que permite que el asistente
     * de escritura reciba el razonamiento en crudo y lo separe él, para poder
     * enseñarlo plegado.
     */
    it('sin herramientas ni esquema, no se pide nada', async () => {
      const { client, params } = stub([{ content: 'hola' }]);
      const proveedor = new GroqProvider(() => client);

      await recoger(proveedor.streamText(peticion(), credencial));

      expect(params[0]?.['reasoning_format']).toBeUndefined();
      expect(params[0]?.['include_reasoning']).toBeUndefined();
    });
  });

  it('una credencial mala falla como AUTH', async () => {
    const proveedor = new GroqProvider(() => {
      throw GroqSdk.APIError.generate(401, {}, 'invalid api key', new Headers());
    });

    await expect(proveedor.verify(credencial)).rejects.toMatchObject({
      kind: ProviderErrorKind.AUTH,
    });
  });

  /*
   * El SDK no declara la ventana de contexto aunque la API la devuelva. Cero
   * significa «no lo sé», no «cabe todo».
   */
  it('lee la ventana de contexto aunque el SDK no la tipe', async () => {
    const { client } = stub(
      [],
      [
        { id: 'llama-3.3-70b-versatile', context_window: 131_072, max_completion_tokens: 32_768 },
        { id: 'raro' },
      ],
    );
    const proveedor = new GroqProvider(() => client);

    const modelos = await proveedor.listModels(credencial);

    expect(modelos[0]).toEqual({
      id: 'llama-3.3-70b-versatile',
      displayName: 'llama-3.3-70b-versatile',
      contextWindow: 131_072,
      maxOutputTokens: 32_768,
    });
    expect(modelos[1]?.contextWindow).toBe(0);
  });

  describe('el conteo aproximado', () => {
    it('avisa de que no es exacto', async () => {
      const { client } = stub([]);
      const proveedor = new GroqProvider(() => client);

      expect((await proveedor.countTokens(peticion(), credencial)).exact).toBe(false);
    });

    /*
     * La cifra gobierna un techo, y un techo que se queda corto no es un techo:
     * más vale pasarse que dejar arrancar algo que no cabe en el cupo.
     */
    it('se pasa antes que quedarse corto', () => {
      const texto = 'a'.repeat(400);
      const request = peticion({ system: texto, messages: [] });

      /* Un tokenizador real da entre tres y cuatro caracteres por token. */
      expect(approximateTokens(request)).toBeGreaterThan(400 / 4);
    });

    it('cuenta todos los mensajes, no solo el primero', () => {
      const uno = approximateTokens(peticion({ messages: [{ role: 'user', content: 'hola' }] }));
      const dos = approximateTokens(
        peticion({
          messages: [
            { role: 'user', content: 'hola' },
            { role: 'assistant', content: 'qué tal' },
          ],
        }),
      );

      expect(dos).toBeGreaterThan(uno);
    });
  });
});
