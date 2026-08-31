import { AiProvider, ProviderError, ProviderErrorKind } from '@app-foundry/core';
import type { GenerationEvent, TextRequest } from '@app-foundry/core';
import { describe, expect, it } from 'vitest';

import { FakeProvider, fakeTokenCount } from '../src/fake/fake-provider.js';

const peticion = (extra: Partial<TextRequest> = {}): TextRequest => ({
  model: 'fake-large',
  system: 'eres un producto',
  messages: [{ role: 'user', content: 'hola' }],
  maxOutputTokens: 1_000,
  ...extra,
});

async function recoger<T>(flujo: AsyncIterable<GenerationEvent<T>>): Promise<GenerationEvent<T>[]> {
  const eventos: GenerationEvent<T>[] = [];
  for await (const evento of flujo) eventos.push(evento);
  return eventos;
}

describe('el proveedor de mentira cumple el puerto', () => {
  it('suplanta a un proveedor real en vez de ser uno nuevo', () => {
    expect(new FakeProvider().id).toBe(AiProvider.ANTHROPIC);
    expect(new FakeProvider({ id: AiProvider.GROQ }).id).toBe(AiProvider.GROQ);
  });

  it('entrega el texto por partes y termina con el consumo', async () => {
    const proveedor = new FakeProvider({ text: 'una idea muy buena' });

    const eventos = await recoger(proveedor.streamText(peticion()));
    const deltas = eventos.filter((e) => e.type === 'delta');

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => e.text).join('')).toBe('una idea muy buena');
    expect(eventos.at(-1)).toEqual({ type: 'done' });
  });

  it('el objeto llega validado en el evento final', async () => {
    const propuestas = { ideas: [{ name: 'Foundry' }] };
    const proveedor = new FakeProvider({ object: propuestas });

    const eventos = await recoger(
      proveedor.streamObject({ ...peticion(), schema: { type: 'object' } }),
    );

    expect(eventos.at(-1)).toEqual({ type: 'done', value: propuestas });
  });

  it('cuenta tokens de forma determinista', async () => {
    const proveedor = new FakeProvider();

    const primera = await proveedor.countTokens(peticion());
    const segunda = await proveedor.countTokens(peticion());

    expect(primera).toEqual(segunda);
    expect(primera.inputTokens).toBe(fakeTokenCount('eres un producto\nhola'));
  });

  it('una credencial rechazada falla como AUTH, que no se reintenta', async () => {
    const proveedor = new FakeProvider();

    await expect(proveedor.verify({ apiKey: 'invalid' })).rejects.toBeInstanceOf(ProviderError);
    await expect(proveedor.verify({ apiKey: 'buena' })).resolves.toBeUndefined();
  });

  it('sabe fallar con cualquier tipo de error', async () => {
    for (const kind of Object.values(ProviderErrorKind)) {
      const proveedor = new FakeProvider({ failWith: kind });
      await expect(recoger(proveedor.streamText(peticion()))).rejects.toMatchObject({ kind });
    }
  });

  /* Lo que hace posible probar la política de reintentos de verdad. */
  it('puede fallar los primeros intentos y responder después', async () => {
    const proveedor = new FakeProvider({
      failWith: ProviderErrorKind.TRANSIENT,
      failTimes: 2,
      text: 'a la tercera',
    });

    await expect(recoger(proveedor.streamText(peticion()))).rejects.toMatchObject({
      kind: ProviderErrorKind.TRANSIENT,
    });
    await expect(recoger(proveedor.streamText(peticion()))).rejects.toMatchObject({
      kind: ProviderErrorKind.TRANSIENT,
    });

    const eventos = await recoger(proveedor.streamText(peticion()));
    expect(eventos.some((e) => e.type === 'done')).toBe(true);
  });

  it('cancelar corta la generación a mitad', async () => {
    const control = new AbortController();
    const proveedor = new FakeProvider({ text: 'uno dos tres cuatro cinco', delayMs: 1 });

    const flujo = proveedor.streamText(peticion({ signal: control.signal }));
    const recibidos: string[] = [];

    await expect(
      (async () => {
        for await (const evento of flujo) {
          if (evento.type === 'delta') {
            recibidos.push(evento.text);
            if (recibidos.length === 2) control.abort();
          }
        }
      })(),
    ).rejects.toMatchObject({ kind: ProviderErrorKind.CANCELLED });

    expect(recibidos).toHaveLength(2);
  });

  it('sin capacidad de búsqueda web no emite fuentes aunque se pidan', async () => {
    const conBusqueda = new FakeProvider({ sources: [{ url: 'https://x', title: 'X' }] });
    const sinBusqueda = new FakeProvider({
      capabilities: { webSearch: false },
      sources: [{ url: 'https://x', title: 'X' }],
    });
    const pide = peticion({ webSearch: { maxUses: 1 } });

    expect((await recoger(conBusqueda.streamText(pide))).some((e) => e.type === 'sources')).toBe(
      true,
    );
    expect((await recoger(sinBusqueda.streamText(pide))).some((e) => e.type === 'sources')).toBe(
      false,
    );
  });

  it('apunta lo que se le ha pedido, para poder comprobarlo', async () => {
    const proveedor = new FakeProvider();

    await recoger(proveedor.streamText(peticion()));
    await proveedor.listModels();

    expect(proveedor.calls.map((c) => c.operation)).toEqual(['streamText', 'listModels']);
  });
});
