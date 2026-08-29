import { useMemo } from 'react';
import rehypeSanitize from 'rehype-sanitize';
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
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // `allowDangerousHtml: false` es el valor por defecto y es el que queremos:
  // el HTML incrustado en el markdown ni siquiera llega al saneador.
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);

export function Markdown({ content }: { content: string }) {
  const html = useMemo(() => String(processor.processSync(content)), [content]);

  return (
    <div
      className="markdown flex flex-col gap-4 text-sm leading-relaxed"
      // Seguro por construcción: lo que entra aquí ha pasado por el saneador.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
