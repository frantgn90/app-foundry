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
 * Respuestas de agente. Las revisiones van a su propia cola, aquí abajo.
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
  /*
   * Con guion bajo y no con dos puntos, por lo mismo que el nombre de la cola:
   * BullMQ rechaza un identificador que lleve `:`. Los dos son UUID de longitud
   * fija, así que un separador de un carácter no puede dar dos claves iguales.
   */
  return `${job.triggerCommentId}_${job.agentId}`;
}

/**
 * Revisiones en abanico (RF-1606, T-32).
 *
 * Cola aparte de la de respuestas y no la misma con un campo que distinga: una
 * revisión dura minutos y llega de cinco en cinco, y una mención espera a que
 * alguien mire la pantalla. Compartir cola dejaría a quien acaba de mencionar a
 * un agente detrás de veinticinco trabajos de una revisión ajena.
 */
export const AGENT_REVIEW_QUEUE = 'ai-review';

/**
 * Lo que le hace falta al worker para que **un** agente revise el documento.
 *
 * Un trabajo por agente y no uno por revisión, porque es la unidad de todo lo
 * demás: el reintento, la idempotencia, la cancelación y el progreso. Un agente
 * lento no bloquea a los otros cuatro y uno que falla no tira la revisión.
 *
 * Identificadores y nada más, como en el otro: el documento se lee al ejecutar
 * y Redis no es sitio para el contenido de nadie (RNF-112).
 */
export interface AgentReviewJob {
  readonly reviewId: string;
  /** La fila de esta ejecución, que ya existe cuando el trabajo se encola. */
  readonly runId: string;
  readonly appId: string;
  readonly agentId: string;
  /**
   * Quién pidió la revisión.
   *
   * El worker lee y escribe **con su identidad**, igual que al contestar una
   * mención: un agente no ve nada que no viera quien lo puso a leer.
   */
  readonly actorUserId: string;
}

/**
 * La clave de idempotencia de una ejecución (T-33).
 *
 * Un agente revisa **una vez** por revisión, aunque el trabajo se encole dos:
 * BullMQ descarta el trabajo repetido por el identificador, y la fila de la
 * ejecución lo remata con su único.
 */
export function agentReviewJobId(job: Pick<AgentReviewJob, 'reviewId' | 'agentId'>): string {
  return `${job.reviewId}_${job.agentId}`;
}

/**
 * Dónde se apunta que una revisión se ha cancelado (RF-1610).
 *
 * En Redis y no en la base porque lo que tiene que ver es el worker **entre
 * agentes**, y consultarlo en la base obligaría a abrir una transacción por
 * comprobación. La fila cambia de estado igual; esto es lo que hace que los
 * agentes que aún no han empezado no lleguen a empezar.
 */
export function reviewCancelKey(reviewId: string): string {
  return `ai:review:cancelled:${reviewId}`;
}
