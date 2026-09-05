/**
 * Tokens de inyección de la capa de IA.
 *
 * Los de plataforma —conexión, entorno, Redis— se reexportan del paquete que
 * los declara: son símbolos, y declararlos aquí daría un token distinto con el
 * mismo nombre.
 */
export { DATABASE, DB_HANDLE, ENV, REDIS } from '@app-foundry/platform';

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
