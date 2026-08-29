import { describe, expect, it } from 'vitest';

import { extractMentions } from '../src/index.js';

describe('extraer menciones', () => {
  it('encuentra un handle', () => {
    expect(extractMentions('Buena idea, @ana')).toEqual(['ana']);
  });

  it('no repite ni distingue mayúsculas', () => {
    expect(extractMentions('@Ana y @ana otra vez')).toEqual(['ana']);
  });

  it('acepta guiones internos, como GitHub', () => {
    expect(extractMentions('@ana-ejemplo lo revisa')).toEqual(['ana-ejemplo']);
  });

  it('una dirección de correo no es una mención', () => {
    // Sin esto, escribir un email convertiría el dominio en media mención.
    expect(extractMentions('escríbeme a ana@example.com')).toEqual([]);
  });

  it('ignora una arroba suelta o pegada a otra', () => {
    expect(extractMentions('@ y @@ana')).toEqual([]);
  });

  it('encuentra varias en el mismo comentario', () => {
    expect(extractMentions('@ana @bruno mirad esto').sort()).toEqual(['ana', 'bruno']);
  });

  it('funciona al principio de una línea', () => {
    expect(extractMentions('primera línea\n@bruno ¿qué opinas?')).toEqual(['bruno']);
  });
});
