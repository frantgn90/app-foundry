/**
 * Proveedor de modelos (RF-1001).
 *
 * La v2 trae dos. Añadir un tercero es registrar un adaptador que cumpla el
 * puerto y sumar su valor aquí: ni el dominio ni la interfaz se enteran (RD-8).
 */
export const AiProvider = {
  ANTHROPIC: 'ANTHROPIC',
  GROQ: 'GROQ',
} as const;
export type AiProvider = (typeof AiProvider)[keyof typeof AiProvider];

/**
 * Para qué se invoca a un modelo (RF-1101).
 *
 * El modelo se asigna **por tipo de tarea**, no por función concreta ni por
 * usuario: es donde el dueño del workspace decide en qué gasta su cuota
 * (RF-1102, D-34). Añadir un uso nuevo de IA es añadir un valor, no rehacer la
 * configuración del workspace (RD-11).
 */
export const AiTask = {
  /** Proponer ideas de app a partir de unas restricciones (RF-1301). */
  IDEA_GENERATION: 'IDEA_GENERATION',
  /** Reescribir un fragmento o el documento entero (RF-1401, RF-1411). */
  TEXT_ASSIST: 'TEXT_ASSIST',
  /** Un agente lee la visión y abre hilos sobre ella (RF-1606). */
  AGENT_REVIEW: 'AGENT_REVIEW',
  /** Un agente contesta en un hilo donde le hablan (RF-1602). */
  AGENT_REPLY: 'AGENT_REPLY',
} as const;
export type AiTask = (typeof AiTask)[keyof typeof AiTask];

/**
 * Por qué falló una invocación.
 *
 * La política de reintento se deriva de esto y de nada más: sin una taxonomía
 * común, cada adaptador acabaría decidiendo por su cuenta qué merece otra
 * oportunidad, y reintentar contra una credencial revocada solo acumula fallos
 * (RNF-703).
 */
export const ProviderErrorKind = {
  /** Credencial inválida o revocada. El proveedor pasa a `INVALID` (RF-1006). */
  AUTH: 'AUTH',
  /** El proveedor pide bajar el ritmo. */
  RATE_LIMIT: 'RATE_LIMIT',
  /** Fallo pasajero: 5xx, corte de conexión, tiempo agotado. */
  TRANSIENT: 'TRANSIENT',
  /** Lo enviado no cabe en la ventana del modelo (RF-1106). */
  CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW',
  /** La respuesta no cumplió el esquema pese a pedirlo. */
  SCHEMA: 'SCHEMA',
  /** El proveedor se negó a responder. */
  CONTENT_FILTER: 'CONTENT_FILTER',
  /** Lo canceló una persona, o se fue el cliente que escuchaba. */
  CANCELLED: 'CANCELLED',
  /** El modelo pedido no existe o dejó de estar disponible. */
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
} as const;
export type ProviderErrorKind = (typeof ProviderErrorKind)[keyof typeof ProviderErrorKind];
