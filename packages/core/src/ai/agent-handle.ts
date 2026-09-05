/**
 * La forma de un handle de agente (RF-1506).
 *
 * La misma que la de una persona, y no por comodidad: un agente se llama
 * escribiendo `@algo` en un comentario, y quien lee esas menciones es el mismo
 * extractor de siempre (`extractMentions`). Un handle que no case con este
 * patrón daría un agente imposible de invocar, y el fallo no aparecería hasta
 * que alguien lo mencionara y no contestara nadie.
 *
 * Que se **distinga** de una persona al leerlo es otra cosa, y no se resuelve
 * con la cadena sino al pintarla: icono y distintivo propios allí donde
 * aparezca (RF-1611).
 */
export const AGENT_HANDLE_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;

/** Si una cadena sirve como handle de agente. */
export function isValidAgentHandle(handle: string): boolean {
  return AGENT_HANDLE_PATTERN.test(handle);
}
