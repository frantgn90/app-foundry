import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { AiProvider } from '@app-foundry/core';

import type { KeyRing } from './key-ring.js';

/**
 * Cifra y descifra las credenciales de proveedor (T-26, RNF-601, RNF-602).
 *
 * AES-256-GCM y **en la aplicación, nunca en SQL**: una función de cifrado del
 * motor lleva la clave dentro de la sentencia, y ahí acaba en los registros de
 * Postgres y en los planes de consulta.
 *
 * El cifrado se ata a su workspace y a su proveedor como **datos autenticados**.
 * No es adorno: sin eso, copiar una fila de un workspace a otro le regala la
 * clave a quien la copió; con eso, la fila copiada simplemente no descifra.
 */
export interface EncryptedCredential {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly keyVersion: number;
}

/** A quién pertenece este secreto. Va autenticado, no solo guardado. */
export interface CredentialContext {
  readonly workspaceId: string;
  readonly provider: AiProvider;
}

export const CipherFailure = {
  /** Se cifró con una clave que ya no está en el llavero. */
  UNKNOWN_KEY: 'UNKNOWN_KEY',
  /** No descifra: o se manipuló, o no es de este workspace, o falta la clave. */
  UNREADABLE: 'UNREADABLE',
} as const;
export type CipherFailure = (typeof CipherFailure)[keyof typeof CipherFailure];

/**
 * Una credencial ilegible no es un fallo cualquiera: la respuesta correcta es
 * marcarla como tal y pedirle a su dueño que la vuelva a introducir, no
 * reintentar ni tumbar la petición con un error genérico (TRD v2 §8.1).
 */
export class CredentialCipherError extends Error {
  constructor(
    readonly failure: CipherFailure,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CredentialCipherError';
  }
}

const ALGORITMO = 'aes-256-gcm';
const BYTES_DE_NONCE = 12;
const BYTES_DE_ETIQUETA = 16;

export class CredentialCipher {
  constructor(private readonly keys: KeyRing) {}

  /** Con qué versión se cifra ahora. Lo que no la lleve está pendiente de rotar. */
  get currentKeyVersion(): number {
    return this.keys.current.version;
  }

  encrypt(apiKey: string, context: CredentialContext): EncryptedCredential {
    const { version, key } = this.keys.current;
    const nonce = randomBytes(BYTES_DE_NONCE);

    const cipher = createCipheriv(ALGORITMO, key, nonce);
    cipher.setAAD(aad(context));

    const cifrado = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);

    /*
     * La etiqueta de autenticación se pega al final del texto cifrado en vez de
     * guardarse en su propia columna: son inseparables —sin ella el cifrado no
     * se puede verificar— y una columna aparte solo añade una forma de que se
     * separen.
     */
    return {
      ciphertext: Buffer.concat([cifrado, cipher.getAuthTag()]),
      nonce,
      keyVersion: version,
    };
  }

  decrypt(encrypted: EncryptedCredential, context: CredentialContext): string {
    const key = this.keys.byVersion(encrypted.keyVersion);
    if (!key) {
      throw new CredentialCipherError(
        CipherFailure.UNKNOWN_KEY,
        `la credencial se cifró con la clave ${String(encrypted.keyVersion)}, que no está en el llavero`,
      );
    }

    if (encrypted.ciphertext.length <= BYTES_DE_ETIQUETA) {
      throw new CredentialCipherError(CipherFailure.UNREADABLE, 'el texto cifrado está incompleto');
    }

    const corte = encrypted.ciphertext.length - BYTES_DE_ETIQUETA;
    const cifrado = encrypted.ciphertext.subarray(0, corte);
    const etiqueta = encrypted.ciphertext.subarray(corte);

    try {
      const decipher = createDecipheriv(ALGORITMO, key, encrypted.nonce);
      decipher.setAAD(aad(context));
      decipher.setAuthTag(etiqueta);
      return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
    } catch (error) {
      /*
       * Aquí caen tanto una manipulación como una fila movida de workspace: para
       * GCM son el mismo suceso, y es correcto que lo sean. Lo que no se puede
       * es distinguirlo hacia fuera con un mensaje distinto, que sería contarle
       * a quien lo intentó cuál de las dos cosas hizo.
       */
      throw new CredentialCipherError(
        CipherFailure.UNREADABLE,
        'la credencial no se pudo descifrar',
        error,
      );
    }
  }

  /** Los últimos caracteres, que es lo único de la clave que llega al cliente (RF-1004). */
  static hint(apiKey: string): string {
    return apiKey.slice(-4);
  }
}

function aad(context: CredentialContext): Buffer {
  return Buffer.from(`${context.workspaceId}:${context.provider}`, 'utf8');
}
