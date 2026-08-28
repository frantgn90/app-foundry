import createClient from 'openapi-fetch';

import type { paths } from './schema.js';

export type { paths, components } from './schema.js';

/**
 * Cliente tipado de la API, generado desde el mismo OpenAPI que publica el
 * servidor.
 *
 * Al derivar del contrato y no de tipos escritos a mano, una ruta o un campo
 * que cambien en el servidor rompen la compilación del cliente, que es cuando
 * conviene enterarse.
 */
export function createApiClient(baseUrl = '/') {
  return createClient<paths>({
    baseUrl,
    // Las cookies de sesión viajan en cada petición: la sesión es opaca y vive
    // en el servidor (RF-107).
    credentials: 'include',
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
