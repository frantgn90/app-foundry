/**
 * Generación de ideas, desde el navegador (RF-1301..1307).
 *
 * Como el asistente, va a pelo con `fetch`: lo que devuelve esa ruta es un flujo
 * de eventos y no un JSON, y el cliente generado del OpenAPI —con razón— no sabe
 * de flujos.
 */
export const MONETISATIONS = ['FREE', 'ONE_OFF', 'SUBSCRIPTION', 'FREEMIUM'] as const;
export type Monetisation = (typeof MONETISATIONS)[number];

export const MONETISATION_LABELS: Record<Monetisation, string> = {
  FREE: 'Free',
  ONE_OFF: 'One-off payment',
  SUBSCRIPTION: 'Subscription',
  FREEMIUM: 'Freemium',
};

export interface IdeaConstraints {
  topic?: string;
  timeAvailable?: string;
  monetisation?: Monetisation;
  audience?: string;
  platform?: string;
  notes?: string;
}

export interface IdeaProposal {
  name: string;
  problem: string;
  audience: string;
  valueProposition: string;
  monetisation: Monetisation;
  effort: string;
  mainRisk: string;
  tags: string[];
  shortDescription: string;
}

export interface IdeaSource {
  url: string;
  title: string;
}

export interface IdeaHandlers {
  /** Si las propuestas se apoyan en algo buscado o solo en lo que el modelo sabe. */
  onMeta: (meta: { grounded: boolean; model: string }) => void;
  onSources: (sources: IdeaSource[]) => void;
  onProposal: (proposal: IdeaProposal) => void;
  onDone: () => void;
  /**
   * `detalle` es lo que dijo el proveedor, ya redactado.
   *
   * Viaja aparte del mensaje porque son cosas distintas: el mensaje es nuestro y
   * está escrito para leerse; el detalle es de un tercero, puede venir en
   * cualquier idioma, y es el que trae el motivo de verdad.
   */
  onError: (message: string, detalle?: string) => void;
}

/** Pide una tanda de ideas y va entregando las que se cierran. */
export async function streamIdeas(
  workspaceId: string,
  body: IdeaConstraints & { exclude?: string[] },
  handlers: IdeaHandlers,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/workspaces/${workspaceId}/ai/ideas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    /* Abortar es lo normal al cerrar el panel: no es un fallo que contar. */
    if (!signal.aborted) handlers.onError('Could not reach the idea generator.');
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
      const bloques = pendiente.split('\n\n');
      pendiente = bloques.pop() ?? '';
      for (const bloque of bloques) despachar(bloque, handlers);
    }
  } catch {
    if (!signal.aborted) handlers.onError('The connection dropped mid-answer.');
  }
}

function despachar(bloque: string, handlers: IdeaHandlers): void {
  const datos = /^data: (.*)$/m.exec(bloque)?.[1];
  if (datos === undefined) return;

  const evento = JSON.parse(datos) as { type: string; [campo: string]: unknown };
  if (evento.type === 'meta') {
    handlers.onMeta({ grounded: evento['grounded'] as boolean, model: evento['model'] as string });
  } else if (evento.type === 'sources') {
    handlers.onSources(evento['sources'] as IdeaSource[]);
  } else if (evento.type === 'proposal') {
    handlers.onProposal(evento['proposal'] as IdeaProposal);
  } else if (evento.type === 'done') {
    handlers.onDone();
  } else if (evento.type === 'error') {
    handlers.onError(evento['message'] as string, evento['detail'] as string);
  }
}

/** Convierte la propuesta elegida en una app, y devuelve su identificador. */
export async function chooseIdea(
  workspaceId: string,
  proposal: IdeaProposal,
  sources: IdeaSource[],
): Promise<{ id: string }> {
  const response = await fetch(`/api/v1/workspaces/${workspaceId}/ai/ideas/choose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...proposal, ...(sources.length > 0 && { sources }) }),
  });
  if (!response.ok) throw new Error(await motivoDe(response));
  return (await response.json()) as { id: string };
}

/**
 * El motivo, en inglés y escrito aquí.
 *
 * De la respuesta se toman el código y los datos, nunca su texto: el servidor
 * razona en español (RNF-502). Lo que no puede inventarse la interfaz —cuántos
 * tokens sobran, qué proveedor— viaja en el cuerpo para esto.
 */
async function motivoDe(response: Response): Promise<string> {
  if (response.status === 403) return 'You are not a member of this workspace.';
  if (response.status === 503) return 'The provider is not answering right now. Try again shortly.';

  const cuerpo = (await response.json().catch(() => null)) as {
    reason?: string;
    message?: string;
    detail?: string;
    provider?: string;
    quota?: number;
    retryAfterSeconds?: number;
  } | null;

  if (cuerpo?.reason === 'PROVIDER_ERROR' && cuerpo.message) {
    return cuerpo.detail ? `${cuerpo.message}\n${cuerpo.detail}` : cuerpo.message;
  }
  if (cuerpo?.reason === 'QUOTA_EXCEEDED') {
    return `This workspace has used up its monthly ${cuerpo.provider ?? 'provider'} token quota. Its owner can raise it in the workspace AI settings.`;
  }
  if (cuerpo?.reason === 'RATE_LIMITED') {
    const minutos = Math.ceil((cuerpo.retryAfterSeconds ?? 60) / 60);
    return `Too many AI requests in a short time. Try again in about ${String(minutos)} minute${minutos === 1 ? '' : 's'}.`;
  }
  return 'No ideas this time. Try again in a moment.';
}
