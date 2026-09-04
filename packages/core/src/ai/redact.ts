/**
 * Quita de un texto lo que no debería salir de aquí (RNF-602).
 *
 * Existe para poder enseñar el mensaje **del proveedor** en la interfaz. Sin él,
 * un fallo llegaba como «algo iba mal en la petición», que no dice ni qué pasó
 * ni dónde se arregla; con el texto original, quien lo lee tiene el motivo y a
 * veces hasta el enlace donde cambiarlo.
 *
 * Lo que no puede pasar es que un cuerpo de error que devuelva la clave la
 * enseñe en pantalla. Se tapa por dos vías, y las dos hacen falta:
 *
 * 1. **La clave exacta**, cuando quien redacta la tiene a mano. Es la garantía
 *    fuerte: no depende de adivinar ninguna forma.
 * 2. **Lo que tenga forma de credencial**, para lo que llegue de un proveedor
 *    que la escriba de otra manera o para cuando no se sepa cuál era.
 */

/** Prefijos de las claves que este producto maneja, y el portador genérico. */
const FORMAS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,
  /gsk_[A-Za-z0-9]{6,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
];

export const REDACTED = '···';

/**
 * Cuánto texto de proveedor se deja pasar.
 *
 * Un mensaje de error puede traer el cuerpo entero de una petición. Lo útil está
 * siempre al principio, y lo demás no se va a leer.
 */
export const MAX_PROVIDER_DETAIL = 400;

export function redactSecrets(texto: string, secretos: readonly string[] = []): string {
  let limpio = texto;

  for (const secreto of secretos) {
    /*
     * Las claves cortas no se tapan: un secreto de tres letras taparía trozos de
     * palabras por todo el mensaje y lo dejaría ilegible sin proteger nada real.
     */
    if (secreto.length < 8) continue;
    limpio = limpio.split(secreto).join(REDACTED);
  }

  for (const forma of FORMAS) limpio = limpio.replace(forma, REDACTED);

  return limpio.length > MAX_PROVIDER_DETAIL ? `${limpio.slice(0, MAX_PROVIDER_DETAIL)}…` : limpio;
}
