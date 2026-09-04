import { ProviderErrorKind, isRetryable } from '@app-foundry/core';
import Groq from 'groq-sdk';
import { describe, expect, it } from 'vitest';

import { translateGroqError } from '../src/groq/errors.js';

const apiError = (status: number, message: string): unknown =>
  Groq.APIError.generate(status, { error: { message } }, message, new Headers());

/**
 * La traducción es paralela a la de Anthropic pero no compartida: son dos
 * jerarquías distintas que hoy se parecen, y el texto de sus errores no. Lo que
 * se comprueba aquí es que un mismo problema acaba en el mismo `kind` pese a
 * llegar con otras palabras.
 */
describe('de un error de Groq a la taxonomía común', () => {
  it('la credencial y el ritmo se traducen igual que en el otro proveedor', () => {
    expect(translateGroqError(apiError(401, 'invalid api key')).kind).toBe(ProviderErrorKind.AUTH);
    expect(translateGroqError(apiError(429, 'rate limit')).kind).toBe(ProviderErrorKind.RATE_LIMIT);
    expect(translateGroqError(apiError(503, 'unavailable')).kind).toBe(ProviderErrorKind.TRANSIENT);
  });

  it('reconoce su forma de decir que no cabe', () => {
    for (const texto of [
      'Please reduce the length of the messages: maximum context length is 8192',
      'request too large for model',
    ]) {
      expect(translateGroqError(apiError(400, texto)).kind).toBe(
        ProviderErrorKind.CONTEXT_OVERFLOW,
      );
    }
  });

  /*
   * Un modelo apagado en los ajustes del proyecto llega como 400, y contarlo
   * como «algo iba mal en la petición» manda a mirar donde no es: la petición
   * está bien y lo que falta es permiso para ese modelo. Pasa sobre todo con los
   * sistemas `compound`, que por dentro enrutan a otros: basta con que uno de
   * ellos esté bloqueado para que falle entero.
   */
  it('un modelo bloqueado en la cuenta no es una petición mal hecha', () => {
    const traducido = translateGroqError(
      apiError(
        400,
        'The model `meta-llama/llama-4-scout-17b-16e-instruct` is blocked at the project level.',
      ),
    );

    expect(traducido.kind).toBe(ProviderErrorKind.MODEL_UNAVAILABLE);
    /* Y no se reintenta: seguirá bloqueado por muchas vueltas que se den. */
    expect(isRetryable(traducido.kind)).toBe(false);
  });

  it('un esquema que no admite se reintenta una vez', () => {
    const traducido = translateGroqError(apiError(400, 'response_format json_schema is invalid'));

    expect(traducido.kind).toBe(ProviderErrorKind.SCHEMA);
    expect(isRetryable(traducido.kind)).toBe(true);
  });

  it('el resto de peticiones mal formadas no se reintentan', () => {
    const traducido = translateGroqError(apiError(400, 'unknown field temperature_x'));

    expect(traducido.kind).toBe(ProviderErrorKind.INVALID_REQUEST);
    expect(isRetryable(traducido.kind)).toBe(false);
  });

  it('cancelar no es un fallo del proveedor', () => {
    expect(translateGroqError(new Groq.APIUserAbortError()).kind).toBe(ProviderErrorKind.CANCELLED);
  });
});
