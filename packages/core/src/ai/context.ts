import type { ModelInfo } from './provider.js';

/**
 * Si lo que se quiere enviar cabe en el modelo elegido (RF-1106).
 *
 * La regla existe para poder **rechazar a tiempo y explicando**, en lugar de
 * recortar el documento en silencio. Un recorte silencioso es la peor de las
 * opciones: el modelo responde, la respuesta parece razonable, y nadie sabe que
 * se le ocultó la mitad del texto sobre el que opinaba.
 */
export const ContextVerdict = {
  /** Cabe. */
  FITS: 'FITS',
  /** No cabe: hay que acortar o elegir un modelo con más ventana. */
  DOES_NOT_FIT: 'DOES_NOT_FIT',
  /**
   * El proveedor no declara la ventana de ese modelo, así que no se puede
   * comprobar. Se deja pasar y se avisa: negarse por no saber dejaría inservible
   * a cualquier modelo cuyo proveedor no publique el dato, y quedarse callado
   * sería fingir que se comprobó.
   */
  UNKNOWN_WINDOW: 'UNKNOWN_WINDOW',
} as const;
export type ContextVerdict = (typeof ContextVerdict)[keyof typeof ContextVerdict];

export interface ContextFit {
  readonly verdict: ContextVerdict;
  /** Si se puede seguir adelante. Falso solo cuando se sabe que no cabe. */
  readonly allowed: boolean;
  /** Tokens de entrada contados o estimados. */
  readonly inputTokens: number;
  /** Tokens de salida que se van a reservar, ya acotados por el modelo. */
  readonly outputTokens: number;
  /** Cuántos sobran. Cero salvo cuando no cabe: es lo que hay que acortar. */
  readonly overflowTokens: number;
}

/**
 * La salida cuenta dentro de la ventana, no aparte: reservar sitio para lo que
 * el modelo va a escribir es parte de que quepa la conversación entera.
 */
export function fitsInContext(
  inputTokens: number,
  requestedOutputTokens: number,
  model: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'>,
): ContextFit {
  const outputTokens =
    model.maxOutputTokens > 0
      ? Math.min(requestedOutputTokens, model.maxOutputTokens)
      : requestedOutputTokens;

  if (model.contextWindow <= 0) {
    return {
      verdict: ContextVerdict.UNKNOWN_WINDOW,
      allowed: true,
      inputTokens,
      outputTokens,
      overflowTokens: 0,
    };
  }

  const total = inputTokens + outputTokens;
  if (total <= model.contextWindow) {
    return {
      verdict: ContextVerdict.FITS,
      allowed: true,
      inputTokens,
      outputTokens,
      overflowTokens: 0,
    };
  }

  return {
    verdict: ContextVerdict.DOES_NOT_FIT,
    allowed: false,
    inputTokens,
    outputTokens,
    overflowTokens: total - model.contextWindow,
  };
}

/** Qué contarle a quien se ha topado con el límite, en sus términos. */
export function explainContextFit(fit: ContextFit, modelId: string): string {
  switch (fit.verdict) {
    case ContextVerdict.FITS:
      return '';
    case ContextVerdict.UNKNOWN_WINDOW:
      return `No se ha podido comprobar si cabe: ${modelId} no declara su ventana de contexto.`;
    case ContextVerdict.DOES_NOT_FIT:
      return `El texto no cabe en ${modelId}: sobran unos ${String(fit.overflowTokens)} tokens. Acórtalo o elige un modelo con más ventana de contexto.`;
  }
}
