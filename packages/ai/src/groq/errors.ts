import { ProviderError, ProviderErrorKind } from '@app-foundry/core';
import Groq from 'groq-sdk';

/**
 * De un error del SDK de Groq a la taxonomía común (TRD v2 §5.3).
 *
 * Mismo criterio que en Anthropic y, deliberadamente, sin factorizar con él: son
 * dos jerarquías de error distintas que casualmente se parecen hoy, y una
 * abstracción compartida obligaría a tocarla cada vez que uno de los dos cambie
 * la suya. Lo que se comparte es la taxonomía de destino, que es lo que importa.
 */
export function translateGroqError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof Groq.APIUserAbortError) {
    return new ProviderError(ProviderErrorKind.CANCELLED, 'cancelado', error);
  }
  if (error instanceof Groq.AuthenticationError) {
    return new ProviderError(ProviderErrorKind.AUTH, 'credencial rechazada', error);
  }
  if (error instanceof Groq.PermissionDeniedError) {
    return new ProviderError(ProviderErrorKind.AUTH, 'la credencial no tiene permiso', error);
  }
  if (error instanceof Groq.RateLimitError) {
    return new ProviderError(
      ProviderErrorKind.RATE_LIMIT,
      'el proveedor pide bajar el ritmo',
      error,
    );
  }
  if (error instanceof Groq.NotFoundError) {
    return new ProviderError(ProviderErrorKind.MODEL_UNAVAILABLE, 'el modelo no existe', error);
  }
  if (error instanceof Groq.BadRequestError) {
    return new ProviderError(kindOfBadRequest(error.message), error.message, error);
  }
  if (error instanceof Groq.APIConnectionError) {
    return new ProviderError(ProviderErrorKind.TRANSIENT, 'no se pudo conectar', error);
  }
  if (error instanceof Groq.APIError && (error.status ?? 0) >= 500) {
    return new ProviderError(ProviderErrorKind.TRANSIENT, 'el proveedor falló', error);
  }
  if (error instanceof Groq.APIError) {
    return new ProviderError(ProviderErrorKind.INVALID_REQUEST, error.message, error);
  }

  return new ProviderError(
    ProviderErrorKind.TRANSIENT,
    error instanceof Error ? error.message : 'fallo desconocido del proveedor',
    error,
  );
}

function kindOfBadRequest(message: string): ProviderErrorKind {
  const texto = message.toLowerCase();
  if (/too large|too long|context length|maximum context/.test(texto)) {
    return ProviderErrorKind.CONTEXT_OVERFLOW;
  }
  /*
   * Un modelo apagado en los ajustes del proyecto de Groq.
   *
   * Llega como 400 y acababa contándose como «algo iba mal en la petición», que
   * manda a mirar donde no es: la petición está bien, lo que pasa es que esa
   * cuenta no tiene permitido ese modelo. Y pasa más de lo que parece con los
   * sistemas `compound`, que por dentro enrutan a otros modelos: basta con que
   * uno de ellos esté bloqueado para que falle entero, aunque el bloqueado no
   * sea el que se eligió aquí.
   */
  if (/blocked at the project level|not enabled|no access to model/.test(texto)) {
    return ProviderErrorKind.MODEL_UNAVAILABLE;
  }
  /*
   * En Groq el esquema estricto se valida antes de generar, así que un esquema
   * mal escrito llega como 400 con la palabra dentro. Es nuestro fallo y no del
   * modelo, pero se le da la misma segunda oportunidad para no divergir del
   * criterio del otro adaptador ante el mismo texto.
   */
  if (/schema|json/.test(texto)) return ProviderErrorKind.SCHEMA;
  return ProviderErrorKind.INVALID_REQUEST;
}
