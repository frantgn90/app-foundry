/*
 * Lo único que este paquete necesita del entorno que lo ejecute. Se declara aquí
 * en lugar de traerse los tipos del navegador o los de Node enteros: así queda a
 * la vista cuál es la dependencia real, y sigue siendo una sola función.
 */
declare const crypto: { getRandomValues: <T extends Uint8Array>(array: T) => T };

/**
 * Genera un UUIDv7: 48 bits de milisegundos y el resto aleatorio.
 *
 * Normalmente los identificadores los pone Postgres con `uuidv7()`, que es lo
 * preferible. Hay un caso donde no sirve: al emitir un aviso se escribe una fila
 * dirigida a otra persona, y las políticas no dejan releerla —es de quien la
 * recibe, no de quien la escribe—, así que `RETURNING` no puede devolver el
 * identificador que acaba de generarse. Como el canal en tiempo real necesita
 * ese identificador para que el navegador pueda reanudar por donde iba, se
 * genera aquí y se envía en la propia inserción.
 *
 * Sigue siendo v7 y no v4 porque el orden importa: los identificadores ordenan
 * igual que el tiempo, y de eso dependen tanto el índice por fecha como la
 * reanudación del canal.
 *
 * La aleatoriedad viene de la Web Crypto, que es estándar y existe igual en el
 * servidor y en el navegador: este paquete es lógica pura y no depende de las
 * bibliotecas de Node. No se usa `Math.random`, que es predecible.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48 bits de milisegundos desde la época, en los primeros 6 bytes.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Versión 7 en el nibble alto del byte 6, y variante RFC 4122 en el byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
