import AnthropicSdk from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';
import { ProviderErrorKind } from '@app-foundry/core';
import type { GenerationEvent, TextRequest } from '@app-foundry/core';
import { describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../src/anthropic/anthropic-provider.js';

/**
 * Un cliente suplantado: el adaptador se prueba entero sin tocar la red y sin
 * gastar la cuota de nadie (RNF-901). Lo que se comprueba es la forma de la
 * petición que sale y el trato que recibe cada forma de respuesta.
 */
interface Turno {
  readonly texto?: string;
  readonly stopReason?: string;
  readonly content?: unknown[];
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

interface Stub {
  readonly client: Anthropic;
  readonly params: Record<string, unknown>[];
  readonly options: Record<string, unknown>[];
}

function stub(turnos: Turno[], modelos: unknown[] = []): Stub {
  const params: Record<string, unknown>[] = [];
  const options: Record<string, unknown>[] = [];
  let indice = 0;

  const client = {
    models: {
      list: () => pagina(modelos),
    },
    messages: {
      countTokens: (p: Record<string, unknown>) => {
        params.push(p);
        return Promise.resolve({ input_tokens: 42 });
      },
      stream: (p: Record<string, unknown>, o: Record<string, unknown>) => {
        params.push(p);
        options.push(o);
        const turno = turnos[indice++] ?? {};
        return flujo(turno);
      },
    },
  };

  return { client: client as unknown as Anthropic, params, options };
}

/* El listado del SDK se recorre y también se espera; con esto valen las dos. */
function pagina(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield await Promise.resolve(item);
    },
  };
}

function flujo(turno: Turno) {
  const texto = turno.texto ?? '';
  return {
    async *[Symbol.asyncIterator]() {
      for (const trozo of texto.split(/(?= )/)) {
        yield await Promise.resolve({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: trozo },
        });
      }
    },
    finalMessage: () =>
      Promise.resolve({
        content: turno.content ?? [{ type: 'text', text: texto }],
        stop_reason: turno.stopReason ?? 'end_turn',
        usage: {
          input_tokens: turno.inputTokens ?? 10,
          output_tokens: turno.outputTokens ?? 5,
        },
      }),
  };
}

const peticion = (extra: Partial<TextRequest> = {}): TextRequest => ({
  model: 'claude-opus-5',
  system: 'eres un product owner',
  messages: [{ role: 'user', content: 'revisa esto' }],
  maxOutputTokens: 4_000,
  ...extra,
});

async function recoger<T>(flujo: AsyncIterable<GenerationEvent<T>>): Promise<GenerationEvent<T>[]> {
  const eventos: GenerationEvent<T>[] = [];
  for await (const evento of flujo) eventos.push(evento);
  return eventos;
}

const credencial = { apiKey: 'sk-de-mentira' };

describe('el adaptador de Anthropic', () => {
  it('entrega el texto por partes y suma el consumo', async () => {
    const { client } = stub([{ texto: 'una idea buena', inputTokens: 100, outputTokens: 20 }]);
    const proveedor = new AnthropicProvider(() => client);

    const eventos = await recoger(proveedor.streamText(peticion(), credencial));

    expect(
      eventos
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('una idea buena');
    expect(eventos.find((e) => e.type === 'usage')?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('pide la salida con esquema en el sitio que la API espera', async () => {
    const { client, params } = stub([{ texto: '{"ideas":[]}' }]);
    const proveedor = new AnthropicProvider(() => client);
    const schema = { type: 'object', additionalProperties: false, required: [], properties: {} };

    const eventos = await recoger(proveedor.streamObject({ ...peticion(), schema }, credencial));

    expect(params[0]?.['output_config']).toEqual({ format: { type: 'json_schema', schema } });
    expect(eventos.at(-1)).toEqual({ type: 'done', value: { ideas: [] } });
  });

  it('una respuesta que no es JSON pese al esquema pide otra oportunidad', async () => {
    const { client } = stub([{ texto: 'lo siento, no puedo' }]);
    const proveedor = new AnthropicProvider(() => client);

    await expect(
      recoger(proveedor.streamObject({ ...peticion(), schema: { type: 'object' } }, credencial)),
    ).rejects.toMatchObject({ kind: ProviderErrorKind.SCHEMA });
  });

  describe('la búsqueda web', () => {
    it('va como herramienta del lado del servidor, con sus dominios', async () => {
      const { client, params } = stub([{ texto: 'hola' }]);
      const proveedor = new AnthropicProvider(() => client);

      await recoger(
        proveedor.streamText(
          peticion({ webSearch: { maxUses: 3, allowedDomains: ['example.com'] } }),
          credencial,
        ),
      );

      expect(params[0]?.['tools']).toEqual([
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 3,
          allowed_domains: ['example.com'],
        },
      ]);
    });

    it('emite las fuentes citadas', async () => {
      const { client } = stub([
        {
          texto: 'según la fuente',
          content: [
            {
              type: 'web_search_tool_result',
              content: [{ url: 'https://a.example', title: 'A' }],
            },
          ],
        },
      ]);
      const proveedor = new AnthropicProvider(() => client);

      const eventos = await recoger(proveedor.streamText(peticion({ webSearch: {} }), credencial));

      expect(eventos.find((e) => e.type === 'sources')?.sources).toEqual([
        { url: 'https://a.example', title: 'A' },
      ]);
    });

    /*
     * El detalle que se lleva por delante a quien no lo sepa: un fallo de la
     * búsqueda llega con HTTP 200, en un bloque cuyo contenido es un objeto de
     * error en vez de una lista. Sin ramificar, recorrerlo revienta.
     */
    it('un fallo de la búsqueda no tira la generación entera', async () => {
      const { client } = stub([
        {
          texto: 'respondo sin fuentes',
          content: [
            {
              type: 'web_search_tool_result',
              content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
            },
          ],
        },
      ]);
      const proveedor = new AnthropicProvider(() => client);

      const eventos = await recoger(proveedor.streamText(peticion({ webSearch: {} }), credencial));

      expect(eventos.some((e) => e.type === 'sources')).toBe(false);
      expect(eventos.at(-1)).toEqual({ type: 'done' });
    });
  });

  /*
   * Un turno con búsqueda puede pararse a mitad. Si no se reanuda, la respuesta
   * se corta sin error y sin aviso: parece que terminó.
   */
  it('reanuda un turno que se paró a mitad, y suma el consumo de los dos', async () => {
    const { client, params } = stub([
      {
        texto: 'busco',
        stopReason: 'pause_turn',
        content: [{ type: 'text', text: 'busco' }],
        inputTokens: 100,
        outputTokens: 10,
      },
      { texto: ' y respondo', inputTokens: 120, outputTokens: 30 },
    ]);
    const proveedor = new AnthropicProvider(() => client);

    const eventos = await recoger(proveedor.streamText(peticion({ webSearch: {} }), credencial));

    expect(params).toHaveLength(2);
    expect((params[1]?.['messages'] as unknown[]).at(-1)).toMatchObject({ role: 'assistant' });
    expect(
      eventos
        .filter((e) => e.type === 'delta')
        .map((e) => e.text)
        .join(''),
    ).toBe('busco y respondo');
    expect(eventos.find((e) => e.type === 'usage')?.usage).toEqual({
      inputTokens: 220,
      outputTokens: 40,
    });
  });

  it('una negativa del proveedor se distingue de un fallo', async () => {
    const { client } = stub([{ texto: '', stopReason: 'refusal' }]);
    const proveedor = new AnthropicProvider(() => client);

    await expect(recoger(proveedor.streamText(peticion(), credencial))).rejects.toMatchObject({
      kind: ProviderErrorKind.CONTENT_FILTER,
    });
  });

  it('la señal de cancelación llega al SDK', async () => {
    const control = new AbortController();
    const { client, options } = stub([{ texto: 'hola' }]);
    const proveedor = new AnthropicProvider(() => client);

    await recoger(proveedor.streamText(peticion({ signal: control.signal }), credencial));

    expect(options[0]?.['signal']).toBe(control.signal);
  });

  it('un modelo sin ventana declarada no pasa por caber en todo', async () => {
    const { client } = stub(
      [],
      [
        {
          id: 'claude-opus-5',
          display_name: 'Opus 5',
          max_input_tokens: 1_000_000,
          max_tokens: 128_000,
        },
        { id: 'raro', display_name: 'Raro', max_input_tokens: null, max_tokens: null },
      ],
    );
    const proveedor = new AnthropicProvider(() => client);

    const modelos = await proveedor.listModels(credencial);

    expect(modelos[0]).toEqual({
      id: 'claude-opus-5',
      displayName: 'Opus 5',
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
    });
    expect(modelos[1]?.contextWindow).toBe(0);
  });

  /* RF-1005: una clave inválida se rechaza en el acto y con motivo. */
  it('verificar una credencial mala falla como AUTH, no como fallo genérico', async () => {
    const proveedor = new AnthropicProvider(() => {
      throw AnthropicSdk.APIError.generate(401, {}, 'invalid x-api-key', new Headers());
    });

    await expect(proveedor.verify(credencial)).rejects.toMatchObject({
      kind: ProviderErrorKind.AUTH,
    });
  });

  it('cuenta tokens por API, así que son exactos', async () => {
    const { client } = stub([]);
    const proveedor = new AnthropicProvider(() => client);

    expect(await proveedor.countTokens(peticion(), credencial)).toEqual({
      inputTokens: 42,
      exact: true,
    });
  });
});
