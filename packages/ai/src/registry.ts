import type { AiProvider, LlmProvider } from '@app-foundry/core';

/**
 * De un identificador de proveedor a su adaptador (RD-8, O12).
 *
 * Es la única pieza que sabe qué adaptadores existen. Todo lo demás —dominio,
 * API, interfaz— trabaja con el identificador que trae la fila del workspace y
 * con el puerto, así que añadir un proveedor nuevo es escribir su adaptador y
 * registrarlo aquí.
 *
 * También es el punto por el que se cuela el proveedor de mentira en pruebas y
 * en desarrollo (T-36): se registra bajo el identificador real al que suplanta,
 * y el resto del sistema recorre exactamente el mismo camino.
 */
export interface ProviderRegistry {
  /** El adaptador de ese proveedor. Falla si no hay ninguno registrado. */
  get(id: AiProvider): LlmProvider;
  has(id: AiProvider): boolean;
  /** Los registrados, para poder ofrecer solo lo que de verdad existe. */
  all(): readonly LlmProvider[];
}

/**
 * Un registro no es una decisión de negocio, así que un identificador sin
 * adaptador es un fallo de configuración del arranque y no un error de
 * proveedor: se lanza como tal, sin `kind`, porque no hay nada que reintentar
 * ni que explicarle a un usuario.
 */
export class UnknownProviderError extends Error {
  constructor(readonly id: AiProvider) {
    super(`No hay adaptador registrado para el proveedor ${id}`);
    this.name = 'UnknownProviderError';
  }
}

export function createProviderRegistry(providers: readonly LlmProvider[]): ProviderRegistry {
  const porId = new Map<AiProvider, LlmProvider>();

  /*
   * El último gana. Es lo que permite arrancar con los adaptadores reales y
   * sustituir uno por el de mentira en un test sin construir otro registro.
   */
  for (const provider of providers) porId.set(provider.id, provider);

  return {
    get(id) {
      const provider = porId.get(id);
      if (!provider) throw new UnknownProviderError(id);
      return provider;
    },
    has: (id) => porId.has(id),
    all: () => [...porId.values()],
  };
}
