/**
 * Tokens de inyección.
 *
 * Se reexportan del paquete de runtime y no se declaran aquí: son **símbolos**,
 * y dos símbolos con el mismo nombre no son el mismo token. Declarándolos en
 * los dos sitios, lo que la API provee y lo que el paso común de invocación
 * pide dejarían de ser lo mismo, y el fallo aparecería al arrancar.
 */
export {
  AI_CIPHER,
  AI_METRICS,
  AI_NOTIFIER,
  AI_REGISTRY,
  DATABASE,
  DB_HANDLE,
  ENV,
  REDIS,
} from '@app-foundry/ai-runtime';
