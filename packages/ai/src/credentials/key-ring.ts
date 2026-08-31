/**
 * El llavero de cifrado de credenciales (T-26, RNF-601).
 *
 * Varias claves a la vez, numeradas. La de número más alto es con la que se
 * cifra; todas sirven para descifrar. Esa es toda la maquinaria que hace falta
 * para rotar sin parar el servicio: se añade una versión nueva, lo nuevo nace
 * cifrado con ella, y lo viejo se sigue leyendo hasta que un recifrado en lote
 * lo ponga al día (AP9).
 *
 * Formato: `1:<clave en base64>,2:<clave en base64>`, y la clave son 32 bytes.
 */
export interface CredentialKey {
  readonly version: number;
  readonly key: Buffer;
}

export interface KeyRing {
  /** Con la que se cifra: la de versión más alta. */
  readonly current: CredentialKey;
  /** Para descifrar lo que se cifró con otra. */
  byVersion(version: number): Buffer | undefined;
  readonly versions: readonly number[];
}

export class KeyRingError extends Error {
  constructor(message: string) {
    super(`AI_CREDENTIAL_KEYS: ${message}`);
    this.name = 'KeyRingError';
  }
}

const BYTES_DE_CLAVE = 32;

export function parseKeyRing(spec: string): KeyRing {
  const entradas = spec
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0);

  if (entradas.length === 0) throw new KeyRingError('no hay ninguna clave');

  const claves = new Map<number, Buffer>();
  for (const entrada of entradas) {
    const separador = entrada.indexOf(':');
    if (separador === -1) {
      throw new KeyRingError(`falta el número de versión en «${entrada}»`);
    }

    const version = Number(entrada.slice(0, separador));
    if (!Number.isInteger(version) || version <= 0) {
      throw new KeyRingError(`la versión ha de ser un entero positivo, y no «${entrada}»`);
    }
    if (claves.has(version)) {
      throw new KeyRingError(`la versión ${String(version)} está dos veces`);
    }

    const key = Buffer.from(entrada.slice(separador + 1), 'base64');
    if (key.length !== BYTES_DE_CLAVE) {
      /*
       * Una clave corta no falla al cifrar: falla al descifrar, meses después y
       * en producción. Mejor no arrancar.
       */
      throw new KeyRingError(
        `la clave ${String(version)} tiene ${String(key.length)} bytes y han de ser ${String(BYTES_DE_CLAVE)}`,
      );
    }

    claves.set(version, key);
  }

  const versiones = [...claves.keys()].sort((a, b) => a - b);
  const ultima = versiones[versiones.length - 1] as number;

  return {
    current: { version: ultima, key: claves.get(ultima) as Buffer },
    byVersion: (version) => claves.get(version),
    versions: versiones,
  };
}
