import { HttpException } from '@nestjs/common';

import { ProviderError, ProviderErrorKind, redactSecrets } from '@app-foundry/core';

/**
 * Traduce un fallo de proveedor a una respuesta HTTP con motivo.
 *
 * Existe porque la taxonomía de errores solo servía **dentro** del flujo: una
 * vez empezado el streaming, un fallo viaja como evento y se explica. Antes de
 * empezar —al contar tokens, que ya es hablar con el proveedor— no había
 * traducción ninguna y todo acababa igual: un 500 con «Assist failed». Se vio
 * generando tráfico contra una instancia con los adaptadores reales y una
 * credencial que no valía (AX2).
 *
 * El estado distingue lo que se arregla esperando de lo que hay que ir a
 * arreglar a los ajustes, porque son dos acciones distintas y un código común no
 * lleva a ninguna.
 */
export function providerHttpStatus(kind: ProviderErrorKind): number {
  switch (kind) {
    /* El proveedor pide bajar el ritmo: esperar sí arregla esto. */
    case ProviderErrorKind.RATE_LIMIT:
      return 429;
    /* No responde ahora mismo, pero puede volver. */
    case ProviderErrorKind.TRANSIENT:
    case ProviderErrorKind.CANCELLED:
      return 503;
    /* Lo que hemos mandado no cabe o no vale: es nuestro, no suyo. */
    case ProviderErrorKind.CONTEXT_OVERFLOW:
      return 400;
    /* Se ha negado a contestar a esto en concreto. */
    case ProviderErrorKind.CONTENT_FILTER:
      return 422;
    /*
     * Credencial rechazada, modelo que ya no existe, petición que no acepta: el
     * fallo es de la puerta de enlace, y ninguno se arregla repitiendo.
     */
    case ProviderErrorKind.AUTH:
    case ProviderErrorKind.MODEL_UNAVAILABLE:
    case ProviderErrorKind.SCHEMA:
    case ProviderErrorKind.INVALID_REQUEST:
      return 502;
  }
}

/**
 * El motivo, en los términos de quien lo lee.
 *
 * La taxonomía es nuestra y el texto va en inglés porque acaba en la interfaz
 * (RNF-502). Se distingue lo que se arregla esperando de lo que hay que ir a
 * arreglar a los ajustes: son dos acciones distintas y un mensaje genérico no
 * lleva a ninguna.
 */
export function providerMessage(kind: ProviderErrorKind): string {
  switch (kind) {
    case ProviderErrorKind.AUTH:
      return 'The provider rejected the key for this workspace. Its owner needs to check it.';
    case ProviderErrorKind.RATE_LIMIT:
      return 'The provider is asking us to slow down. Try again in a moment.';
    case ProviderErrorKind.CONTEXT_OVERFLOW:
      return 'The text is too long for the model assigned to this task.';
    case ProviderErrorKind.CONTENT_FILTER:
      return 'The provider refused to answer this one.';
    case ProviderErrorKind.MODEL_UNAVAILABLE:
      /*
       * Dos cosas caen aquí y las dos se arreglan en el mismo sitio: un modelo
       * retirado del catálogo y uno que la cuenta del proveedor tiene apagado.
       * Lo que importa es que quien lo lea sepa que hay que ir a los ajustes, no
       * a reintentar.
       */
      return 'The provider will not run the model assigned to this task. Check that it is still offered and enabled for your account.';
    case ProviderErrorKind.SCHEMA:
    case ProviderErrorKind.INVALID_REQUEST:
      return 'Something was wrong with the request. Nothing has been changed.';
    case ProviderErrorKind.CANCELLED:
      return 'Cancelled.';
    case ProviderErrorKind.TRANSIENT:
      return 'The provider did not answer. Try again in a moment.';
  }
}

/**
 * El mismo fallo, ya como respuesta: estado, tipo, explicación y **lo que dijo el
 * proveedor**.
 *
 * El detalle va aparte del mensaje y no en su lugar: el mensaje es nuestro, está
 * escrito para leerse y no cambia; el detalle es de un tercero, puede venir en
 * cualquier idioma y decir cualquier cosa. Pero es el que trae el motivo de
 * verdad —«ese modelo está bloqueado en tu proyecto», con su enlace—, y sin él
 * había que ir a leer los registros del servidor para saber qué pasaba.
 *
 * Va redactado, porque un cuerpo de error puede devolver la credencial dentro
 * (RNF-602). El secreto se tapa por su valor exacto cuando se conoce, que es la
 * garantía fuerte, y por su forma cuando no.
 */
export function toProviderHttpException(
  error: ProviderError,
  secretos: readonly string[] = [],
): HttpException {
  const statusCode = providerHttpStatus(error.kind);
  return new HttpException(
    {
      statusCode,
      reason: 'PROVIDER_ERROR',
      kind: error.kind,
      message: providerMessage(error.kind),
      detail: redactSecrets(error.message, secretos),
    },
    statusCode,
  );
}
