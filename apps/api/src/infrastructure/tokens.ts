/**
 * Tokens de inyección.
 *
 * `Database` y `Redis` son tipos, no clases: la inyección por tipo de Nest no
 * puede resolverlos, así que se inyectan por token explícito.
 */
export const ENV = Symbol('ENV');
export const DB_HANDLE = Symbol('DB_HANDLE');
export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');
