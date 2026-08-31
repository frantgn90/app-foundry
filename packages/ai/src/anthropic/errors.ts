import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, ProviderErrorKind } from '@app-foundry/core';

/**
 * De un error del SDK a la taxonomía común (TRD v2 §5.3).
 *
 * La traducción no es cosmética: de ella sale la política de reintento
 * (RNF-703). Confundir un fallo pasajero con una petición mal formada hace que
 * se insista contra algo que nunca va a funcionar, y confundirlo al revés tira
 * una generación que se habría salvado esperando dos segundos.
 */
export function translateAnthropicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof Anthropic.APIUserAbortError) {
    return new ProviderError(ProviderErrorKind.CANCELLED, 'cancelado', error);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError(ProviderErrorKind.AUTH, 'credencial rechazada', error);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(ProviderErrorKind.AUTH, 'la credencial no tiene permiso', error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError(
      ProviderErrorKind.RATE_LIMIT,
      'el proveedor pide bajar el ritmo',
      error,
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError(ProviderErrorKind.MODEL_UNAVAILABLE, 'el modelo no existe', error);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError(kindOfBadRequest(error.message), error.message, error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(ProviderErrorKind.TRANSIENT, 'no se pudo conectar', error);
  }
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return new ProviderError(ProviderErrorKind.TRANSIENT, 'el proveedor falló', error);
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(ProviderErrorKind.INVALID_REQUEST, error.message, error);
  }

  /*
   * Lo que no reconocemos se trata como pasajero. Es la apuesta menos mala: un
   * fallo desconocido en una llamada remota suele serlo, y la política acota los
   * intentos, así que equivocarse aquí cuesta dos reintentos y no un bucle.
   */
  return new ProviderError(ProviderErrorKind.TRANSIENT, mensajeDe(error), error);
}

/**
 * Un 400 puede ser tres cosas muy distintas, y cada una merece un trato: que no
 * cabe (se le explica al usuario qué hacer, RF-1106), que el modelo incumplió el
 * esquema (una segunda oportunidad) o que la petición está mal construida (culpa
 * nuestra, y repetirla da lo mismo).
 */
function kindOfBadRequest(message: string): ProviderErrorKind {
  const texto = message.toLowerCase();
  if (/too long|exceed|context window|max_tokens/.test(texto)) {
    return ProviderErrorKind.CONTEXT_OVERFLOW;
  }
  if (/schema|json/.test(texto)) return ProviderErrorKind.SCHEMA;
  return ProviderErrorKind.INVALID_REQUEST;
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : 'fallo desconocido del proveedor';
}
