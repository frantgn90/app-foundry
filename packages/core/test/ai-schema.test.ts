import { describe, expect, it } from 'vitest';

import { assertStrictSchema, checkStrictSchema, nullable } from '../src/ai/schema.js';

const IDEAS = {
  type: 'object',
  additionalProperties: false,
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'problem', 'monetization'],
        properties: {
          name: { type: 'string' },
          problem: { type: 'string' },
          monetization: nullable('string'),
        },
      },
    },
  },
};

describe('el subconjunto estricto que aceptan los dos proveedores', () => {
  it('un esquema del producto bien escrito pasa', () => {
    expect(checkStrictSchema(IDEAS)).toEqual([]);
  });

  /*
   * El fallo que esta comprobación existe para atrapar: en Anthropic funciona,
   * en Groq no, y sin esto la diferencia aparece en la primera llamada real,
   * en producción y gastando cuota.
   */
  it('rechaza un campo declarado y no exigido', () => {
    const problemas = checkStrictSchema({
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' }, extra: { type: 'string' } },
    });

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.message).toContain('extra');
  });

  it('rechaza un objeto que admite propiedades de más', () => {
    const problemas = checkStrictSchema({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    });

    expect(problemas[0]?.message).toContain('additionalProperties');
  });

  it('rechaza exigir algo que no se ha declarado', () => {
    const problemas = checkStrictSchema({
      type: 'object',
      additionalProperties: false,
      required: ['name', 'fantasma'],
      properties: { name: { type: 'string' } },
    });

    expect(problemas[0]?.message).toContain('fantasma');
  });

  it('rechaza una lista que no dice de qué es', () => {
    const problemas = checkStrictSchema({
      type: 'object',
      additionalProperties: false,
      required: ['tags'],
      properties: { tags: { type: 'array' } },
    });

    expect(problemas[0]?.path).toBe('$.tags');
  });

  it('rechaza las referencias, que cada proveedor resuelve a su manera', () => {
    const problemas = checkStrictSchema({ $ref: '#/definitions/idea' });

    expect(problemas[0]?.message).toContain('referencias');
  });

  it('señala el sitio exacto dentro de un esquema anidado', () => {
    const roto = {
      type: 'object',
      additionalProperties: false,
      required: ['ideas'],
      properties: {
        ideas: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [],
            properties: { name: { type: 'string' } },
          },
        },
      },
    };

    expect(checkStrictSchema(roto)[0]?.path).toBe('$.ideas[]');
  });

  it('lo que puede faltar se expresa como unión con null, y eso vale', () => {
    expect(nullable('string')).toEqual({ type: ['string', 'null'] });
    expect(
      checkStrictSchema({
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: {},
      }),
    ).toEqual([]);
  });

  it('afirmar sobre un esquema roto explica qué está mal y dónde', () => {
    expect(() => {
      assertStrictSchema(
        { type: 'object', properties: { a: { type: 'string' } } },
        'esquema de ideas',
      );
    }).toThrow(/esquema de ideas[\s\S]*additionalProperties/);
  });

  it('sobre uno correcto no dice nada', () => {
    expect(() => {
      assertStrictSchema(IDEAS);
    }).not.toThrow();
  });
});
