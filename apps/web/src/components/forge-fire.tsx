/**
 * El fuego de la forja, al pie de la pantalla de entrada.
 *
 * No hay JavaScript ni canvas: son dos capas de ruido desplazándose hacia
 * arriba a distinta velocidad, mezcladas entre sí y con un degradado de color,
 * y luego pasadas por `brightness → blur → contrast`. El desenfoque convierte
 * la densidad del ruido en un campo continuo y el contraste lo recorta en
 * lenguas de llama.
 *
 * Adaptado de «CSS Only Fire», de Simon Goellner (@simeydotme):
 * https://codepen.io/simeydotme/pen/PoyzbPM
 *
 * Es una llama de gas azul en los dos modos, y baja: se queda a los pies de la
 * pantalla porque es el suelo de la escena y no el asunto. Lo que cambia entre
 * claro y oscuro no es el color sino cómo se pinta —sobre fondo claro hay que
 * invertirla, porque la receta original se satura y tapa la página—. La receta
 * entera vive en `index.css`, bajo «El fuego de la forja»; aquí solo se cuelga
 * la capa.
 *
 * Lo único que se anima es `background-position`, pero que sea barato de
 * calcular no lo hace gratis: el `filter` obliga a rehacer la capa en cada
 * fotograma. Por eso está solo en esta pantalla, y no en el resto de la
 * aplicación.
 */
/**
 * Si el fuego se enciende.
 *
 * Está apagado. Se apaga y se enciende desde esta línea, y el resto —esta capa
 * y la receta entera en `index.css`, bajo «El fuego de la forja»— se queda
 * donde está: apagarlo no es haber decidido que no vuelve.
 *
 * El tipo es explícito para que no se estreche a `false`: sin él, todo lo que
 * hay debajo pasa a ser código inalcanzable.
 */
const FUEGO_ENCENDIDO: boolean = false;

export function ForgeFire() {
  if (!FUEGO_ENCENDIDO) return null;
  // Decorativo puro: no hay nada que anunciar a quien no lo ve.
  return <div className="fuego-forja" aria-hidden />;
}
