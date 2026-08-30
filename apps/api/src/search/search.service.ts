import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { currentTx } from '../database/request-context.js';
import type { SearchHitDto, SearchResultsDto } from './search.dto.js';

/** Tantos como caben en una lista que se recorre con la vista, no leyendo. */
const TOPE = 25;

interface Fila extends Record<string, unknown> {
  id: string;
  name: string;
  short_description: string | null;
  status: string;
  access_level: string;
  icon_emoji: string;
  icon_color: string;
  archived_at: Date | null;
  workspace_id: string;
  workspace_name: string;
  excerpt: string | null;
}

@Injectable()
export class SearchService {
  /**
   * Busca por nombre, descripción, etiquetas y contenido, en todos tus
   * workspaces a la vez (RF-604).
   *
   * No lleva ningún filtro de permisos escrito a mano, y es deliberado: la
   * consulta pasa por las políticas de `apps` y `workspaces`, que son las mismas
   * que deciden qué ves en el listado. Una búsqueda con su propia idea de lo que
   * puedes ver es una búsqueda que algún día enseñará de más, porque son dos
   * reglas que hay que acordarse de cambiar a la vez.
   */
  async search(termino: string): Promise<SearchResultsDto> {
    const limpio = termino.trim();
    if (limpio.length === 0) return { items: [], query: '' };

    const consulta = aConsulta(limpio);
    if (consulta === null) return { items: [], query: limpio };

    const filas = await currentTx().execute<Fila>(sql`
      SELECT a.id, a.name, a.short_description, a.status, a.access_level,
             a.icon_emoji, a.icon_color, a.archived_at,
             w.id AS workspace_id, w.name AS workspace_name,
             ts_headline('simple', coalesce(d.current_content, ''),
                         to_tsquery('simple', ${consulta}),
                         'MaxWords=18, MinWords=6, MaxFragments=1, StartSel=«, StopSel=»')
               AS excerpt
        FROM apps a
        JOIN workspaces w ON w.id = a.workspace_id
        LEFT JOIN documents d ON d.app_id = a.id AND d.type = 'VISION'
       WHERE a.search_tsv @@ to_tsquery('simple', ${consulta})
       ORDER BY ts_rank(a.search_tsv, to_tsquery('simple', ${consulta})) DESC,
                a.updated_at DESC
       LIMIT ${TOPE}
    `);

    return { items: filas.rows.map(aDto), query: limpio };
  }
}

function aDto(fila: Fila): SearchHitDto {
  return {
    id: fila.id,
    name: fila.name,
    shortDescription: fila.short_description,
    status: fila.status,
    accessLevel: fila.access_level,
    icon: { emoji: fila.icon_emoji, color: fila.icon_color },
    isArchived: fila.archived_at !== null,
    workspaceId: fila.workspace_id,
    workspaceName: fila.workspace_name,
    excerpt: fila.excerpt && fila.excerpt.length > 0 ? fila.excerpt : null,
  };
}

/**
 * Convierte lo que alguien escribe en una consulta que Postgres entiende.
 *
 * `to_tsquery` es exigente con su sintaxis y revienta ante un `&` suelto o un
 * paréntesis sin cerrar, así que no se le puede dar lo tecleado tal cual: se
 * parte en palabras y se reconstruye. Además así se controla la semántica —todas
 * las palabras, no cualquiera— que es lo que espera quien escribe dos.
 *
 * Cada palabra lleva `:*` al final para que busque por prefijo. Es lo que
 * compensa no reducir palabras a su raíz: «coment» encuentra «comentario» y
 * «comments» sin tener que saber en qué idioma está escrito el documento.
 */
function aConsulta(texto: string): string | null {
  const palabras = texto
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((p) => p.length > 0)
    .slice(0, 8)
    .map((p) => `${p.toLowerCase()}:*`);

  return palabras.length > 0 ? palabras.join(' & ') : null;
}
