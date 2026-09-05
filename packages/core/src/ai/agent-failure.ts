import { ProviderErrorKind } from './enums.js';

/**
 * Cómo se le cuenta a una persona que su agente no pudo contestar (RF-1615).
 *
 * Vive en el dominio y no en el worker porque es texto de producto: lo lee
 * quien mencionó al agente, en su bandeja, minutos después de haberlo hecho.
 *
 * Dos reglas al redactarlo. La primera es **decir qué pasó y qué hacer**: «el
 * proveedor rechazó la credencial» le sirve al dueño del workspace, mientras
 * que «error 401» le manda a preguntarle a alguien. La segunda es no repetir el
 * mensaje del proveedor tal cual: viene en inglés técnico, cambia sin avisar y
 * a veces trae dentro trozos de la petición.
 */
export function agentFailureReason(kind: ProviderErrorKind | null): string {
  switch (kind) {
    case ProviderErrorKind.AUTH:
      return 'the provider rejected this workspace’s credential — check it in AI settings';
    case ProviderErrorKind.RATE_LIMIT:
      return 'the provider kept asking us to slow down, and the retries ran out';
    case ProviderErrorKind.TRANSIENT:
      return 'the provider was unreachable, and the retries ran out';
    case ProviderErrorKind.CONTEXT_OVERFLOW:
      return 'the document and the thread no longer fit in this model’s context';
    case ProviderErrorKind.SCHEMA:
      return 'the model’s answer never came back in a usable shape';
    case ProviderErrorKind.CONTENT_FILTER:
      return 'the provider refused to answer this one';
    case ProviderErrorKind.CANCELLED:
      return 'the request was cancelled before it finished';
    case ProviderErrorKind.MODEL_UNAVAILABLE:
      return 'the model assigned to agent replies is no longer available — pick another in AI settings';
    case ProviderErrorKind.INVALID_REQUEST:
      return 'we sent the provider something it could not read. This one is on us';
    /*
     * Lo que no es del proveedor: un fallo de la base, un despliegue a mitad,
     * un error de programación. No se enseña el mensaje interno —no le dice
     * nada a quien lo lee y puede llevar dentro datos de la petición— pero sí
     * se dice que ocurrió, que es lo que evita el silencio.
     */
    case null:
      return 'something went wrong on our side while it was answering';
  }
}

/** Cuando el modelo termina sin texto y sin nada pensado: no hay qué escribir. */
export const AGENT_REPLY_NOTHING_BACK = 'the model came back empty, without even a draft';

/** Cuando el agente ya no puede intervenir en el momento en que le tocaba hablar. */
export const AGENT_REPLY_GONE = 'it is paused or no longer part of this app';
