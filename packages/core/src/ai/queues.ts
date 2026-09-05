/**
 * Las colas de IA: el contrato entre quien encola y quien consume (T-32).
 *
 * Vive en `core` a propósito. La API encola y el worker consume, y son dos
 * procesos que se despliegan por separado; si el nombre de la cola y la forma
 * del trabajo vivieran en cualquiera de los dos, el otro tendría que
 * conocerlo. Aquí no hay ninguna dependencia de BullMQ: solo el nombre y la
 * forma, que es lo único que ambos necesitan compartir.
 */

/**
 * Respuestas de agente. Las revisiones van a su propia cola, en H13.
 *
 * Con guion y no con dos puntos, aunque el TRD la llamara `ai:agent-reply`:
 * BullMQ usa `:` para componer sus claves de Redis y rechaza un nombre que lo
 * lleve. Se descubrió arrancando el worker, no compilando.
 */
export const AGENT_REPLY_QUEUE = 'ai-agent-reply';

/**
 * Qué le hace falta al worker para escribir una respuesta.
 *
 * Identificadores y nada más: ni el texto del comentario, ni el documento, ni
 * el perfil. Todo eso se lee al ejecutar, y por dos motivos. Uno, que un
 * trabajo encolado puede tardar y lo que guardase sería una foto vieja. Y dos,
 * que Redis no es sitio para contenido de nadie (RNF-112): lo que aquí se
 * guarda no dice nada de lo que se está hablando.
 */
export interface AgentReplyJob {
  /** El agente que responde. */
  readonly agentId: string;
  /** El hilo en el que responde. */
  readonly threadId: string;
  /** El comentario que lo provocó: una mención, o una respuesta de persona. */
  readonly triggerCommentId: string;
  /**
   * Quién lo provocó.
   *
   * El worker lee **con su identidad**, no con una privilegiada: así un agente
   * no puede ver nada que no viera quien le habló, y el aislamiento sigue
   * siendo el mismo de siempre en vez de uno nuevo que haya que confiar.
   */
  readonly actorUserId: string;
  /** Por cuál de los tres disparos llegó aquí (RF-1602). */
  readonly trigger: AgentTrigger;
}

export const AgentTrigger = {
  /** Una persona lo mencionó con `@handle`. */
  MENTION: 'MENTION',
  /** Una persona respondió en un hilo donde ya había escrito. */
  REPLY: 'REPLY',
} as const;
export type AgentTrigger = (typeof AgentTrigger)[keyof typeof AgentTrigger];

/**
 * La clave de idempotencia de un trabajo (T-33).
 *
 * Es lo que hace que un reintento no escriba dos veces: BullMQ descarta un
 * trabajo cuyo identificador ya existe, y la escritura comprueba además que no
 * haya respondido ya a ese mismo comentario. Un agente responde **una vez** a
 * lo que le dijeron, aunque el trabajo se encole dos.
 */
export function agentReplyJobId(job: Pick<AgentReplyJob, 'agentId' | 'triggerCommentId'>): string {
  return `${job.triggerCommentId}:${job.agentId}`;
}
