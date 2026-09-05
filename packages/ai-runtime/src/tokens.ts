/**
 * Tokens de inyección compartidos por la API y el worker.
 *
 * `Database` y `Redis` son tipos, no clases: la inyección por tipo de Nest no
 * puede resolverlos, así que se inyectan por token explícito.
 *
 * Viven aquí porque son **símbolos**, y dos símbolos con el mismo nombre no son
 * el mismo token. Si cada proceso declarara los suyos, el contenedor del worker
 * no resolvería lo que este paquete pide y el fallo aparecería al arrancar, no
 * al compilar.
 */
export const ENV = Symbol('ENV');
export const DB_HANDLE = Symbol('DB_HANDLE');
export const DATABASE = Symbol('DATABASE');
export const REDIS = Symbol('REDIS');

/** De `ProviderId` a adaptador (T-21). */
export const AI_REGISTRY = Symbol('AI_REGISTRY');
/** El cifrador de credenciales. Nulo si la instancia no tiene llavero (RD-12). */
export const AI_CIPHER = Symbol('AI_CIPHER');

/**
 * Los dos enganches hacia fuera.
 *
 * El paso común de invocación mide y avisa, y ninguna de las dos cosas es suya:
 * medir es de observabilidad y avisar es del producto. Se piden como puertos
 * para que este paquete no arrastre el módulo de métricas ni el de
 * notificaciones —que la API tiene y el worker no necesita igual— y para que
 * cada proceso enchufe lo suyo.
 */
export const AI_METRICS = Symbol('AI_METRICS');
export const AI_NOTIFIER = Symbol('AI_NOTIFIER');
