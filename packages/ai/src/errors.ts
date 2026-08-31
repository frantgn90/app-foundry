import type { CancellationSignal } from '@app-foundry/core';

/**
 * Puente entre la señal del dominio y la de la plataforma.
 *
 * `core` declara la cancelación con la forma de `AbortSignal` pero sin
 * nombrarlo, porque no conoce ninguna plataforma. Aquí, que sí la conocemos, un
 * `AbortSignal` real pasa tal cual y cualquier otra implementación se refleja en
 * uno nuevo. Sin esto habría que elegir entre atar el dominio a una biblioteca o
 * renunciar a cancelar.
 */
export function toAbortSignal(signal: CancellationSignal | undefined): AbortSignal | undefined {
  if (!signal) return undefined;
  if (signal instanceof AbortSignal) return signal;

  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', () => {
      controller.abort();
    });
  }
  return controller.signal;
}

/**
 * Cuánto pidió esperar el proveedor, si lo dijo.
 *
 * Se le hace caso por encima de nuestro cálculo de espera: sabe mejor que
 * nosotros cuándo volverá a aceptar la petición.
 */
export function retryAfterMsFrom(headers: unknown): number | undefined {
  if (!(headers instanceof Headers)) return undefined;

  const value = headers.get('retry-after');
  if (!value) return undefined;

  const segundos = Number(value);
  return Number.isFinite(segundos) ? segundos * 1_000 : undefined;
}
