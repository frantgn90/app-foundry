import { AiProvider } from '@app-foundry/core';
import { describe, expect, it } from 'vitest';

import { FakeProvider } from '../src/fake/fake-provider.js';
import { createProviderRegistry, UnknownProviderError } from '../src/registry.js';

describe('el registro de proveedores', () => {
  it('resuelve un identificador a su adaptador', () => {
    const anthropic = new FakeProvider({ id: AiProvider.ANTHROPIC });
    const groq = new FakeProvider({ id: AiProvider.GROQ });
    const registro = createProviderRegistry([anthropic, groq]);

    expect(registro.get(AiProvider.ANTHROPIC)).toBe(anthropic);
    expect(registro.get(AiProvider.GROQ)).toBe(groq);
  });

  it('solo ofrece los que de verdad están registrados', () => {
    const registro = createProviderRegistry([new FakeProvider({ id: AiProvider.GROQ })]);

    expect(registro.has(AiProvider.GROQ)).toBe(true);
    expect(registro.has(AiProvider.ANTHROPIC)).toBe(false);
    expect(registro.all()).toHaveLength(1);
  });

  /*
   * Un identificador sin adaptador es configuración mal montada al arrancar, no
   * un fallo del proveedor: no lleva `kind` porque no hay nada que reintentar.
   */
  it('un proveedor sin adaptador falla como error de configuración', () => {
    const registro = createProviderRegistry([]);

    expect(() => registro.get(AiProvider.ANTHROPIC)).toThrow(UnknownProviderError);
    expect(() => registro.get(AiProvider.ANTHROPIC)).toThrow(/ANTHROPIC/);
  });

  /* Es como el proveedor de mentira sustituye a uno real sin tocar nada más. */
  it('el último registrado con un identificador gana', () => {
    const real = new FakeProvider({ id: AiProvider.ANTHROPIC, text: 'real' });
    const mentira = new FakeProvider({ id: AiProvider.ANTHROPIC, text: 'mentira' });

    expect(createProviderRegistry([real, mentira]).get(AiProvider.ANTHROPIC)).toBe(mentira);
  });
});
