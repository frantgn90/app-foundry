import { describe, expect, it } from 'vitest';

import { MAX_PROVIDER_DETAIL, REDACTED, redactSecrets } from '../src/index.js';

/**
 * Lo que decide si se puede enseñar el mensaje del proveedor.
 *
 * Enseñarlo vale mucho —trae el motivo y a veces el enlace donde arreglarlo—,
 * pero un cuerpo de error puede devolver la credencial dentro. Aquí se comprueba
 * que no sale de aquí ni sabiendo cuál era ni sin saberlo.
 */
describe('tapar lo que no debe salir', () => {
  it('la clave exacta desaparece, esté donde esté', () => {
    const clave = 'gsk_unaClaveDeVerdadLarga123';
    const limpio = redactSecrets(`Invalid API Key: ${clave} (project foo)`, [clave]);

    expect(limpio).not.toContain(clave);
    expect(limpio).toContain(REDACTED);
    /* Y lo demás sigue ahí: taparlo todo sería no enseñar nada. */
    expect(limpio).toContain('project foo');
  });

  /*
   * La segunda red: un proveedor puede escribir la clave de otra forma, o puede
   * no saberse cuál era. Se tapa lo que tiene forma de credencial.
   */
  it('lo que parece una credencial se tapa aunque no se sepa cuál era', () => {
    for (const secreto of [
      'sk-ant-api03-abcdefghij',
      'gsk_abcdefghijklmno',
      'Bearer abcdefgh1234',
    ]) {
      expect(redactSecrets(`fallo con ${secreto} al final`)).not.toContain(secreto);
    }
  });

  /*
   * Un secreto de tres letras taparía trozos de palabras por todo el mensaje y
   * lo dejaría ilegible sin proteger nada real.
   */
  it('un secreto ridículamente corto no destroza el mensaje', () => {
    expect(redactSecrets('the model is blocked', ['the'])).toBe('the model is blocked');
  });

  it('un mensaje normal pasa intacto', () => {
    const texto = 'The model `llama-4-scout` is blocked at the project level.';
    expect(redactSecrets(texto)).toBe(texto);
  });

  /* Un error puede traer el cuerpo entero de la petición: lo útil está al principio. */
  it('se recorta lo larguísimo', () => {
    const limpio = redactSecrets('x'.repeat(MAX_PROVIDER_DETAIL + 50));

    expect(limpio.length).toBe(MAX_PROVIDER_DETAIL + 1);
    expect(limpio.endsWith('…')).toBe(true);
  });
});
