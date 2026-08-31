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
 * En oscuro es la forja —blanco, naranja, oro—; en claro, una llama de gas
 * azulada, porque sobre fondo claro la receta original se satura y tapa la
 * página. La receta entera vive en `index.css`, bajo «El fuego de la forja»;
 * aquí solo se cuelga la capa.
 *
 * Lo único que se anima es `background-position`, pero que sea barato de
 * calcular no lo hace gratis: el `filter` obliga a rehacer la capa en cada
 * fotograma. Por eso está solo en esta pantalla, y no en el resto de la
 * aplicación.
 */
export function ForgeFire() {
  // Decorativo puro: no hay nada que anunciar a quien no lo ve.
  return <div className="fuego-forja" aria-hidden />;
}
