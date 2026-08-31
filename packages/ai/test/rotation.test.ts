import { AiProvider } from '@app-foundry/core';
import { describe, expect, it } from 'vitest';

import { CredentialCipher } from '../src/credentials/cipher.js';
import { parseKeyRing } from '../src/credentials/key-ring.js';
import { rotateCredentials, type StoredCredential } from '../src/credentials/rotation.js';

const clave = (semilla: number): string => Buffer.alloc(32, semilla).toString('base64');
const VIEJO = new CredentialCipher(parseKeyRing(`1:${clave(1)}`));
const NUEVO = new CredentialCipher(parseKeyRing(`1:${clave(1)},2:${clave(2)}`));
const SIN_LA_VIEJA = new CredentialCipher(parseKeyRing(`2:${clave(2)}`));

function guardada(workspaceId: string, apiKey: string, cipher = VIEJO): StoredCredential {
  const provider = AiProvider.ANTHROPIC;
  const cifrada = cipher.encrypt(apiKey, { workspaceId, provider });
  return { workspaceId, provider, ...cifrada };
}

describe('el recifrado en lote', () => {
  it('pasa a la clave nueva lo que estaba con la vieja', () => {
    const fila = guardada('ws-1', 'sk-secreta');

    const resultado = rotateCredentials([fila], NUEVO);

    expect(resultado.rotated).toHaveLength(1);
    expect(resultado.rotated[0]?.keyVersion).toBe(2);
    expect(resultado.rotated[0]?.previousKeyVersion).toBe(1);
  });

  it('lo recifrado sigue siendo la misma clave', () => {
    const fila = guardada('ws-1', 'sk-secreta');

    const [rotada] = rotateCredentials([fila], NUEVO).rotated;

    expect(
      NUEVO.decrypt(
        { ciphertext: rotada!.ciphertext, nonce: rotada!.nonce, keyVersion: rotada!.keyVersion },
        { workspaceId: 'ws-1', provider: AiProvider.ANTHROPIC },
      ),
    ).toBe('sk-secreta');
  });

  it('lo que ya estaba al día se deja en paz', () => {
    const fila = guardada('ws-1', 'sk-secreta', NUEVO);

    const resultado = rotateCredentials([fila], NUEVO);

    expect(resultado.rotated).toHaveLength(0);
    expect(resultado.upToDate).toBe(1);
  });

  /*
   * Una credencial ilegible es un problema de su workspace. Tirar el lote entero
   * por ella dejaría a los demás a medias, que es peor: se informa y se sigue.
   */
  it('una credencial ilegible se informa y no detiene el lote', () => {
    const perdida = guardada('ws-perdida', 'sk-inalcanzable');
    const sana = guardada('ws-sana', 'sk-recuperable', SIN_LA_VIEJA);

    const resultado = rotateCredentials([perdida, sana], SIN_LA_VIEJA);

    expect(resultado.unreadable).toEqual([
      { workspaceId: 'ws-perdida', provider: AiProvider.ANTHROPIC, reason: 'UNKNOWN_KEY' },
    ]);
    expect(resultado.upToDate).toBe(1);
  });

  it('cada credencial se recifra atada a su propio workspace', () => {
    const filas = [guardada('ws-1', 'sk-una'), guardada('ws-2', 'sk-otra')];

    const { rotated } = rotateCredentials(filas, NUEVO);

    /* Cruzar los contextos tiene que fallar: es lo que protege de mover filas. */
    expect(() =>
      NUEVO.decrypt(
        { ciphertext: rotated[0]!.ciphertext, nonce: rotated[0]!.nonce, keyVersion: 2 },
        { workspaceId: 'ws-2', provider: AiProvider.ANTHROPIC },
      ),
    ).toThrow();
  });

  it('un lote vacío no es un caso especial', () => {
    expect(rotateCredentials([], NUEVO)).toEqual({ rotated: [], upToDate: 0, unreadable: [] });
  });
});
