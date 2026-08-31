import { randomBytes } from 'node:crypto';

import { AiProvider } from '@app-foundry/core';
import { describe, expect, it } from 'vitest';

import { CipherFailure, CredentialCipher } from '../src/credentials/cipher.js';
import { KeyRingError, parseKeyRing } from '../src/credentials/key-ring.js';

const clave = (semilla: number): string => Buffer.alloc(32, semilla).toString('base64');
const llavero = (spec: string) => parseKeyRing(spec);

const CONTEXTO = { workspaceId: 'ws-1', provider: AiProvider.ANTHROPIC };
const CLAVE_API = 'sk-ant-api03-secreto-de-verdad';

describe('el llavero', () => {
  it('cifra con la versión más alta y descifra con cualquiera', () => {
    const anillo = llavero(`1:${clave(1)},2:${clave(2)}`);

    expect(anillo.current.version).toBe(2);
    expect(anillo.versions).toEqual([1, 2]);
    expect(anillo.byVersion(1)).toBeDefined();
    expect(anillo.byVersion(9)).toBeUndefined();
  });

  it('el orden de las claves en la variable no manda', () => {
    expect(llavero(`3:${clave(3)},1:${clave(1)}`).current.version).toBe(3);
  });

  /*
   * Una clave corta no falla al cifrar: falla al descifrar, meses después y en
   * producción. Se rechaza al arrancar.
   */
  it('rechaza al arrancar todo lo que fallaría más tarde', () => {
    expect(() => llavero('')).toThrow(KeyRingError);
    expect(() => llavero('sin-version')).toThrow(/versión/);
    expect(() => llavero(`0:${clave(1)}`)).toThrow(/entero positivo/);
    expect(() => llavero(`1:${clave(1)},1:${clave(2)}`)).toThrow(/dos veces/);
    expect(() => llavero(`1:${Buffer.alloc(16).toString('base64')}`)).toThrow(/32/);
  });
});

describe('el cifrado de una credencial', () => {
  const cipher = new CredentialCipher(llavero(`1:${clave(1)}`));

  it('va y vuelve', () => {
    const cifrada = cipher.encrypt(CLAVE_API, CONTEXTO);

    expect(cipher.decrypt(cifrada, CONTEXTO)).toBe(CLAVE_API);
  });

  it('la clave no aparece en lo cifrado', () => {
    const cifrada = cipher.encrypt(CLAVE_API, CONTEXTO);

    expect(cifrada.ciphertext.toString('utf8')).not.toContain('sk-ant');
    expect(cifrada.ciphertext.toString('base64')).not.toContain(
      Buffer.from(CLAVE_API).toString('base64'),
    );
  });

  it('cifrar dos veces lo mismo da dos cosas distintas', () => {
    const primera = cipher.encrypt(CLAVE_API, CONTEXTO);
    const segunda = cipher.encrypt(CLAVE_API, CONTEXTO);

    expect(primera.nonce.equals(segunda.nonce)).toBe(false);
    expect(primera.ciphertext.equals(segunda.ciphertext)).toBe(false);
  });

  /*
   * El motivo de atar el cifrado a su workspace y su proveedor: sin esto,
   * copiar una fila a otro workspace le regala la clave a quien la copió.
   */
  it('una fila movida a otro workspace deja de descifrar', () => {
    const cifrada = cipher.encrypt(CLAVE_API, CONTEXTO);

    expect(() => cipher.decrypt(cifrada, { ...CONTEXTO, workspaceId: 'ws-2' })).toThrow(
      expect.objectContaining({ failure: CipherFailure.UNREADABLE }),
    );
  });

  it('y tampoco descifra si se le cambia el proveedor', () => {
    const cifrada = cipher.encrypt(CLAVE_API, CONTEXTO);

    expect(() => cipher.decrypt(cifrada, { ...CONTEXTO, provider: AiProvider.GROQ })).toThrow(
      expect.objectContaining({ failure: CipherFailure.UNREADABLE }),
    );
  });

  it('un texto cifrado manipulado no cuela', () => {
    const cifrada = cipher.encrypt(CLAVE_API, CONTEXTO);
    cifrada.ciphertext[0] = (cifrada.ciphertext[0] ?? 0) ^ 0xff;

    expect(() => cipher.decrypt(cifrada, CONTEXTO)).toThrow(
      expect.objectContaining({ failure: CipherFailure.UNREADABLE }),
    );
  });

  it('un texto cifrado truncado tampoco', () => {
    expect(() =>
      cipher.decrypt(
        { ciphertext: randomBytes(4), nonce: randomBytes(12), keyVersion: 1 },
        CONTEXTO,
      ),
    ).toThrow(/incompleto/);
  });
});

describe('la rotación', () => {
  it('lo nuevo se cifra con la clave nueva y lo viejo se sigue leyendo', () => {
    const antes = new CredentialCipher(llavero(`1:${clave(1)}`));
    const vieja = antes.encrypt(CLAVE_API, CONTEXTO);
    expect(vieja.keyVersion).toBe(1);

    /* Se añade la versión 2 sin retirar la 1: es toda la maniobra. */
    const despues = new CredentialCipher(llavero(`1:${clave(1)},2:${clave(2)}`));

    expect(despues.encrypt(CLAVE_API, CONTEXTO).keyVersion).toBe(2);
    expect(despues.decrypt(vieja, CONTEXTO)).toBe(CLAVE_API);
  });

  /*
   * Retirar una clave antes de recifrar lo que la usaba deja credenciales
   * ilegibles. Se distingue del resto de fallos para poder pedir que la vuelvan
   * a introducir en vez de reintentar contra algo irrecuperable.
   */
  it('retirar una clave demasiado pronto se reconoce como tal', () => {
    const antes = new CredentialCipher(llavero(`1:${clave(1)}`));
    const vieja = antes.encrypt(CLAVE_API, CONTEXTO);

    const despues = new CredentialCipher(llavero(`2:${clave(2)}`));

    expect(() => despues.decrypt(vieja, CONTEXTO)).toThrow(
      expect.objectContaining({ failure: CipherFailure.UNKNOWN_KEY }),
    );
  });
});

describe('la pista', () => {
  it('reconoce una clave sin reconstruirla', () => {
    expect(CredentialCipher.hint(CLAVE_API)).toBe('rdad');
    expect(CLAVE_API).toContain(CredentialCipher.hint(CLAVE_API));
  });
});
