import type { AiProvider } from '@app-foundry/core';

import {
  CredentialCipherError,
  type CredentialCipher,
  type EncryptedCredential,
} from './cipher.js';

/**
 * Recifrado en lote tras una rotación de clave (T-26, AP9).
 *
 * La parte con criterio va aquí, separada de quien lee y escribe en la base de
 * datos, para poder probarla sin Postgres delante. El comando que la usa es un
 * envoltorio: leer filas, llamar a esto, escribir el resultado.
 */
export interface StoredCredential {
  readonly workspaceId: string;
  readonly provider: AiProvider;
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly keyVersion: number;
}

export interface RotatedCredential extends StoredCredential {
  readonly previousKeyVersion: number;
}

export interface UnreadableCredential {
  readonly workspaceId: string;
  readonly provider: AiProvider;
  readonly reason: string;
}

export interface RotationResult {
  /** Recifradas con la clave actual: hay que escribirlas. */
  readonly rotated: readonly RotatedCredential[];
  /** Ya estaban al día. */
  readonly upToDate: number;
  /**
   * No se pudieron descifrar, casi siempre porque su clave se retiró antes de
   * tiempo. Se informan en lugar de tirar el lote: una credencial ilegible es un
   * problema de ese workspace, y detener la rotación entera por ella dejaría a
   * los demás a medias, que es peor.
   */
  readonly unreadable: readonly UnreadableCredential[];
}

export function rotateCredentials(
  rows: readonly StoredCredential[],
  cipher: CredentialCipher,
): RotationResult {
  const objetivo = cipher.currentKeyVersion;
  const rotated: RotatedCredential[] = [];
  const unreadable: UnreadableCredential[] = [];
  let upToDate = 0;

  for (const row of rows) {
    if (row.keyVersion === objetivo) {
      upToDate += 1;
      continue;
    }

    const context = { workspaceId: row.workspaceId, provider: row.provider };

    try {
      const apiKey = cipher.decrypt(encryptedOf(row), context);
      const nueva = cipher.encrypt(apiKey, context);

      rotated.push({
        ...context,
        ciphertext: nueva.ciphertext,
        nonce: nueva.nonce,
        keyVersion: nueva.keyVersion,
        previousKeyVersion: row.keyVersion,
      });
    } catch (error) {
      unreadable.push({
        ...context,
        reason:
          error instanceof CredentialCipherError ? error.failure : 'fallo inesperado al descifrar',
      });
    }
  }

  return { rotated, upToDate, unreadable };
}

function encryptedOf(row: StoredCredential): EncryptedCredential {
  return { ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.keyVersion };
}
