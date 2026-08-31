import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, ProviderErrorKind, isRetryable } from '@app-foundry/core';
import { describe, expect, it } from 'vitest';

import { translateAnthropicError } from '../src/anthropic/errors.js';

const apiError = (status: number, message: string): unknown =>
  Anthropic.APIError.generate(status, { error: { message } }, message, new Headers());

describe('de un error del SDK a la taxonomía común', () => {
  it('una credencial rechazada o sin permiso es AUTH, y no se reintenta', () => {
    for (const status of [401, 403]) {
      const traducido = translateAnthropicError(apiError(status, 'nope'));
      expect(traducido.kind).toBe(ProviderErrorKind.AUTH);
      expect(isRetryable(traducido.kind)).toBe(false);
    }
  });

  it('un exceso de ritmo se reintenta', () => {
    const traducido = translateAnthropicError(apiError(429, 'slow down'));
    expect(traducido.kind).toBe(ProviderErrorKind.RATE_LIMIT);
    expect(isRetryable(traducido.kind)).toBe(true);
  });

  it('un modelo que no existe no se reintenta', () => {
    expect(translateAnthropicError(apiError(404, 'no such model')).kind).toBe(
      ProviderErrorKind.MODEL_UNAVAILABLE,
    );
  });

  it('un fallo del servidor es pasajero', () => {
    expect(translateAnthropicError(apiError(503, 'overloaded')).kind).toBe(
      ProviderErrorKind.TRANSIENT,
    );
  });

  it('un corte de conexión es pasajero', () => {
    expect(translateAnthropicError(new Anthropic.APIConnectionError({})).kind).toBe(
      ProviderErrorKind.TRANSIENT,
    );
  });

  it('cancelar no es un fallo del proveedor', () => {
    expect(translateAnthropicError(new Anthropic.APIUserAbortError()).kind).toBe(
      ProviderErrorKind.CANCELLED,
    );
  });

  /*
   * Un 400 son tres cosas distintas y cada una merece un trato: explicarle al
   * usuario que no cabe, dar una segunda oportunidad al esquema, o admitir que
   * la petición la construimos mal nosotros y repetirla no arregla nada.
   */
  describe('los tres cuatrocientos', () => {
    it('lo que no cabe se distingue para poder explicarlo', () => {
      expect(translateAnthropicError(apiError(400, 'prompt is too long')).kind).toBe(
        ProviderErrorKind.CONTEXT_OVERFLOW,
      );
    });

    it('un esquema incumplido tiene su segunda oportunidad', () => {
      const traducido = translateAnthropicError(apiError(400, 'invalid json schema'));
      expect(traducido.kind).toBe(ProviderErrorKind.SCHEMA);
      expect(isRetryable(traducido.kind)).toBe(true);
    });

    it('una petición mal construida es culpa nuestra y no se reintenta', () => {
      const traducido = translateAnthropicError(apiError(400, 'unexpected parameter foo'));
      expect(traducido.kind).toBe(ProviderErrorKind.INVALID_REQUEST);
      expect(isRetryable(traducido.kind)).toBe(false);
    });
  });

  it('lo que ya viene traducido se deja como está', () => {
    const original = new ProviderError(ProviderErrorKind.CANCELLED, 'ya traducido');
    expect(translateAnthropicError(original)).toBe(original);
  });

  it('lo desconocido se trata como pasajero, que es lo que suele ser', () => {
    expect(translateAnthropicError(new Error('vete a saber')).kind).toBe(
      ProviderErrorKind.TRANSIENT,
    );
  });

  it('la causa original se conserva para poder depurar', () => {
    const original = apiError(500, 'boom');
    expect(translateAnthropicError(original).cause).toBe(original);
  });
});
