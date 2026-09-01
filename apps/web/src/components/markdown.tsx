import { memo, useMemo } from 'react';
import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/**
 * Renderiza markdown ya saneado (RF-513).
 *
 * `rehype-sanitize` va **después** de convertir a HTML y antes de serializar,
 * que es el único punto donde puede quitar lo que no debe estar. El contenido
 * lo escribe cualquiera con permiso de edición, así que un `<script>` en una
 * visión no puede convertirse en código ejecutándose en el navegador de otro.
 */
/**
 * Deja en cada bloque la posición que ocupaba en el markdown original.
 *
 * Es la pieza que hace posible comentar sobre una selección: el usuario
 * selecciona texto en el HTML renderizado, pero el ancla tiene que expresarse
 * en posiciones del markdown, que es lo que se guarda. Sin este rastro no habría
 * forma de pasar de una cosa a la otra (TRD §9.1).
 *
 * Se marcan solo los bloques —párrafos, títulos, elementos de lista— porque son
 * la unidad en la que se selecciona; marcar cada `<em>` llenaría el HTML de
 * atributos sin aportar precisión.
 */
const BLOQUES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre']);

function conPosiciones() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (!BLOQUES.has(node.tagName)) return;
      const position = node.position;
      if (position?.start.offset === undefined) return;
      node.properties = {
        ...node.properties,
        'data-src-start': String(position.start.offset),
        'data-src-end': String(position.end.offset ?? position.start.offset),
      };
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // `allowDangerousHtml: false` es el valor por defecto y es el que queremos:
  // el HTML incrustado en el markdown ni siquiera llega al saneador.
  .use(remarkRehype)
  .use(conPosiciones)
  // El saneador va después de generar el HTML y antes de serializarlo, que es
  // el único punto donde puede quitar lo que no debe estar. Se le permiten los
  // atributos de posición, que son datos nuestros y no del documento.
  .use(rehypeSanitize, {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      // Los nombres tienen que coincidir exactamente con las claves que escribe
      // el plugin: permitir la forma camelCase mientras se escribe la literal
      // hace que el saneador se los lleve sin decir nada.
      '*': [...(defaultSchema.attributes?.['*'] ?? []), 'data-src-start', 'data-src-end'],
    },
  })
  .use(rehypeStringify);

/**
 * El documento renderizado.
 *
 * Va memoizado, y no es una optimización: es lo que impide que **la selección
 * del usuario se rompa**. Este `div` se pinta con `dangerouslySetInnerHTML`, así
 * que cada vez que React lo revisa puede reemplazar sus hijos; y reemplazar los
 * nodos que contienen una selección la destruye. Como la página cambia de estado
 * cada vez que alguien marca texto —aparece el menú, se apunta el fragmento
 * pendiente—, sin esta barrera seleccionar y perder lo seleccionado eran la
 * misma acción.
 *
 * Con `memo`, un render de la ficha no llega hasta aquí salvo que el texto haya
 * cambiado de verdad, que es justo cuando sí hay que repintarlo.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const html = useMemo(() => String(processor.processSync(content)), [content]);

  return (
    <div
      className="markdown flex flex-col gap-4 text-sm leading-relaxed"
      // Seguro por construcción: lo que entra aquí ha pasado por el saneador.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
