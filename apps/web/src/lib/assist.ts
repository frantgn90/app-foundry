/**
 * El asistente de escritura, desde el navegador (RF-1401, RF-1407).
 *
 * Va a pelo con `fetch` y no por el cliente tipado: lo que devuelve esa ruta no
 * es un JSON sino un flujo de eventos, y el cliente generado del OpenAPI —con
 * razón— no sabe de flujos. Tampoco sirve `EventSource`, que solo hace GET y no
 * lleva cuerpo, y aquí hace falta mandar el alcance y la revisión.
 */
export const ASSIST_ACTIONS = ['IMPROVE', 'TIGHTEN', 'SUMMARISE', 'EXPAND', 'PROOFREAD'] as const;
export type AssistAction = (typeof ASSIST_ACTIONS)[number];

/** Cómo se llama cada acción en pantalla, y qué promete. */
export const ASSIST_LABELS: Record<AssistAction, { label: string; hint: string }> = {
  IMPROVE: { label: 'Improve writing', hint: 'Clearer, without changing what it says' },
  TIGHTEN: { label: 'Make it concrete', hint: 'Swaps vague words for specific ones' },
  SUMMARISE: { label: 'Shorten', hint: 'Same points, fewer words' },
  EXPAND: { label: 'Develop', hint: 'Finishes what the text leaves hanging' },
  PROOFREAD: { label: 'Fix spelling', hint: 'Spelling and grammar only' },
};

export type AssistScope = 'SELECTION' | 'DOCUMENT';

export interface AssistCommand {
  action: AssistAction;
  scope: AssistScope;
  start?: number;
  end?: number;
  revision: number;
}

export interface AssistMeta {
  provider: string;
  model: string;
  variant: string;
  contextTrimmed: boolean;
  maxOutputTokens: number;
  estimatedTokens: number;
  revision: number;
  degraded: string[];
}

export interface AssistEstimate {
  provider: string;
  modelId: string;
  variant: string;
  contextTrimmed: boolean;
  maxOutputTokens: number;
  estimatedTokens: number;
}

export interface AssistHandlers {
  onMeta: (meta: AssistMeta) => void;
  onDelta: (text: string) => void;
  /** Lo que el modelo se dice a sí mismo, que llega aparte y aparte se queda. */
  onReasoning: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * Pide una reescritura y va entregando lo que llega.
 *
 * Se corta con la señal, y cortarla no es solo dejar de mirar: el servidor
 * aborta la llamada al proveedor, así que descartar a media generación deja de
 * gastar cuota de verdad.
 */
export async function streamAssist(
  appId: string,
  command: AssistCommand,
  handlers: AssistHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/apps/${appId}/document/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal,
    });
  } catch {
    /* Abortar aquí es lo normal al descartar: no es un fallo que contar. */
    if (!signal.aborted) handlers.onError('Could not reach the assistant.');
    return;
  }

  if (!response.ok || !response.body) {
    handlers.onError(await motivoDe(response));
    return;
  }

  const lector = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pendiente = '';

  try {
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;

      pendiente += value;
      /*
       * Los eventos se separan por una línea en blanco, y un trozo de red puede
       * cortar por cualquier sitio: se procesa lo que esté completo y el resto
       * espera al siguiente trozo.
       */
      const bloques = pendiente.split('\n\n');
      pendiente = bloques.pop() ?? '';
      for (const bloque of bloques) despachar(bloque, handlers);
    }
  } catch {
    if (!signal.aborted) handlers.onError('The connection dropped mid-answer.');
  }
}

function despachar(bloque: string, handlers: AssistHandlers): void {
  const datos = /^data: (.*)$/m.exec(bloque)?.[1];
  if (datos === undefined) return;

  const evento = JSON.parse(datos) as { type: string; [campo: string]: unknown };
  if (evento.type === 'meta') handlers.onMeta(evento as unknown as AssistMeta);
  else if (evento.type === 'delta') handlers.onDelta(evento['text'] as string);
  else if (evento.type === 'reasoning') handlers.onReasoning(evento['text'] as string);
  else if (evento.type === 'done') handlers.onDone();
  else if (evento.type === 'error') handlers.onError(evento['message'] as string);
}

/** El techo de tokens antes de comprometerse (RF-1412). */
export async function estimateAssist(
  appId: string,
  command: AssistCommand,
): Promise<AssistEstimate> {
  const response = await fetch(`/api/v1/apps/${appId}/document/assist/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(await motivoDe(response));
  return (await response.json()) as AssistEstimate;
}

/**
 * El motivo, en inglés y escrito aquí.
 *
 * El servidor razona en español (RNF-502) y esto es interfaz, así que de la
 * respuesta se toman el **código** y los datos, nunca su texto. Lo que no puede
 * inventarse la interfaz —cuántos tokens sobran, qué modelo— viaja en el cuerpo
 * precisamente para esto.
 */
async function motivoDe(response: Response): Promise<string> {
  if (response.status === 403) return 'You can read this app but not edit it.';
  if (response.status === 409) return 'Someone saved while you were reading. Reload to try again.';
  if (response.status === 503) return 'The provider is not answering right now. Try again shortly.';
  if (response.status === 429) return 'Too many AI requests in a short time. Give it a minute.';

  const cuerpo = (await response.json().catch(() => null)) as {
    reason?: string;
    overflowTokens?: number;
    modelId?: string;
  } | null;

  if (cuerpo?.reason === 'CONTEXT_OVERFLOW') {
    return `This is about ${String(cuerpo.overflowTokens ?? 0)} tokens too long for ${
      cuerpo.modelId ?? 'the model assigned to this task'
    }. Shorten it, or pick a model with a larger context window.`;
  }
  if (response.status === 400) return 'That request does not match the document any more.';
  return 'The assistant could not answer.';
}
