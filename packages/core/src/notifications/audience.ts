/**
 * A quién le incumbe cada cosa que pasa (RF-902).
 *
 * Vive aquí, separado de la emisión, porque es la parte con criterio: avisar de
 * más convierte el centro de notificaciones en ruido que se ignora, y avisar de
 * menos hace que la conversación se quede sin respuesta. Y porque es también
 * donde un error pasa desapercibido: nadie se queja de un aviso que nunca llegó.
 */

/** Tipos de aviso. Coinciden con el enum de la base de datos. */
export type NotificationType =
  | 'WORKSPACE_INVITED'
  | 'APP_COMMENTED'
  | 'THREAD_REPLIED'
  | 'THREAD_RESOLVED'
  | 'MENTIONED'
  | 'DOCUMENT_VERSION_SAVED'
  | 'PRECURSOR_TRANSFERRED'
  | 'APPS_INHERITED'
  /** El modelo asignado a una tarea de IA ya no está en el catálogo (RF-1009). */
  | 'AI_MODEL_UNAVAILABLE'
  /** El consumo de un proveedor ha pasado del umbral de aviso (RF-1205). */
  | 'AI_QUOTA_THRESHOLD';

/**
 * Quiénes rondan una acción, ya consultados de la base de datos.
 *
 * Se pasan como listas y no como consultas para que decidir a quién se avisa no
 * dependa de tener una base de datos delante.
 */
export interface Entorno {
  /** Quien ha hecho la acción. Nunca recibe aviso de ella (RF-905). */
  actor: string;
  /** Precursor de la app afectada, si la hay. */
  precursor?: string | undefined;
  /**
   * Quienes ya se han implicado en la app: han comentado o han guardado alguna
   * versión. Es lo que en los requisitos se llama «contribuidor», y se calcula
   * por participación real y no por permisos, porque tener acceso de escritura
   * a un workspace entero no significa querer saber de todas sus apps.
   */
  participantes?: string[] | undefined;
  /** Quienes han escrito en el hilo concreto. */
  participantesDelHilo?: string[] | undefined;
  /** Quien abrió el hilo. */
  autorDelHilo?: string | undefined;
  /** Mencionados por handle en el texto, ya resueltos a identificadores. */
  mencionados?: string[] | undefined;
  /** Destinatario directo, cuando la acción va dirigida a alguien concreto. */
  destinatario?: string | undefined;
}

/** Un aviso a punto de emitirse: a quién y de qué. */
export interface Aviso {
  userId: string;
  type: NotificationType;
}

function unicos(valores: (string | undefined)[]): string[] {
  return [...new Set(valores.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * Reparte una acción entre quienes deben enterarse.
 *
 * Dos reglas atraviesan todos los casos. La primera es que el actor queda fuera
 * siempre: enterarte de lo que acabas de hacer tú no es información. La segunda
 * es que a cada persona le llega **un solo** aviso por acción, y si le tocan
 * varios se queda el más específico: quien es mencionado en una respuesta de un
 * hilo suyo recibe la mención, porque es lo que de verdad le reclama.
 */
export function audiencia(type: NotificationType, entorno: Entorno): Aviso[] {
  const {
    actor,
    precursor,
    participantes,
    participantesDelHilo,
    autorDelHilo,
    mencionados,
    destinatario,
  } = entorno;

  // Las menciones se reparten en todos los casos donde hay texto de por medio, y
  // ganan a cualquier otro aviso por la misma acción (RF-908).
  const mencionadosReales = unicos(mencionados ?? []).filter((id) => id !== actor);

  const resto = (): string[] => {
    switch (type) {
      // Un hilo nuevo interesa a quien sostiene la app: su precursor y quienes
      // ya se han implicado en ella.
      case 'APP_COMMENTED':
        return unicos([precursor, ...(participantes ?? [])]);

      // Una respuesta interesa a quien está en esa conversación, no a toda la
      // app: si no, cada hilo largo acabaría notificando a gente que lo dejó
      // hace tiempo.
      case 'THREAD_REPLIED':
        return unicos([autorDelHilo, ...(participantesDelHilo ?? [])]);

      // Dar por cerrada una conversación le importa sobre todo a quien la abrió.
      case 'THREAD_RESOLVED':
        return unicos([autorDelHilo]);

      // Una versión nueva la quiere saber quien sostiene la app; el resto del
      // workspace se enteraría de cada guardado ajeno sin haberlo pedido.
      case 'DOCUMENT_VERSION_SAVED':
        return unicos([precursor, ...(participantes ?? [])]);

      // Acciones dirigidas a una persona concreta.
      case 'WORKSPACE_INVITED':
      case 'PRECURSOR_TRANSFERRED':
      case 'APPS_INHERITED':
        return unicos([destinatario]);

      /*
       * Le llega al dueño del workspace, que es quien puede arreglarlo: nadie
       * más elige modelo. La alternativa era no avisar y que la función fallara
       * la próxima vez que alguien la usara, cuando ya nadie relaciona el fallo
       * con un modelo que el proveedor retiró hace semanas.
       */
      case 'AI_MODEL_UNAVAILABLE':
      case 'AI_QUOTA_THRESHOLD':
        return unicos([destinatario]);

      // La mención no tiene más audiencia que los mencionados.
      case 'MENTIONED':
        return [];
    }
  };

  const avisos: Aviso[] = mencionadosReales.map((userId) => ({ userId, type: 'MENTIONED' }));
  const yaAvisados = new Set(mencionadosReales);

  for (const userId of resto()) {
    if (userId === actor || yaAvisados.has(userId)) continue;
    yaAvisados.add(userId);
    avisos.push({ userId, type });
  }

  return avisos;
}
