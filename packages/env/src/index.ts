import type { z } from 'zod';

import { type Env, envSchema } from './schema.js';

export { envSchema, type Env } from './schema.js';

/**
 * Error de configuración con un mensaje pensado para quien arranca el proceso,
 * no para quien lo depura después.
 */
export class EnvValidationError extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    const detail = issues
      .map((issue) => `  · ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    super(`La configuración del entorno no es válida:\n${detail}\n\nRevisa tu fichero .env`);
    this.name = 'EnvValidationError';
  }
}

/** Fuente de configuración: `process.env` o cualquier cosa con esa forma. */
export type EnvSource = Record<string, string | undefined>;

/**
 * Valida el entorno y devuelve la configuración ya tipada.
 *
 * Se llama una vez, al arrancar. A partir de ahí nadie vuelve a leer
 * `process.env`: lo que circula por la aplicación es este objeto.
 */
export function loadEnv(source: EnvSource = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}
