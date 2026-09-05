/**
 * Tokens de inyección de la plataforma.
 *
 * `Database` y `Redis` son tipos, no clases: la inyección por tipo de Nest no
 * puede resolverlos, así que se inyectan por token explícito.
 *
 * Viven en su propio paquete porque son **símbolos**, y dos símbolos con el
 * mismo nombre no son el mismo token. Todo lo que se inyecta en más de un
 * proceso —el paso común de invocación, el emisor de avisos— tiene que pedir
 * exactamente estos, y no una copia con el mismo nombre: la copia compilaría y
 * fallaría al arrancar.
 *
 * Y están aquí y no en el paquete de IA porque no son de la IA: una conexión a
 * base de datos no tiene nada que ver con invocar a un modelo, y que el emisor
 * de avisos tuviera que depender del runtime de IA para pedir Redis sería una
 * dependencia al revés.
 */
export const ENV = Symbol('ENV');
export const DB_HANDLE = Symbol('DB_HANDLE');
export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');
