import { describe, expect, it } from 'vitest';

import { type Anchor, createAnchor, reanchor } from '../src/index.js';

/** Documento de trabajo, con una frase repetida a propósito. */
const DOC = `# The problem

I read a lot and remember little. Notes end up scattered.

# Who it's for

People who read to learn. Notes end up scattered.
`;

/** Ancla sobre la primera aparición de un fragmento. */
function anclarPrimera(texto: string, fragmento: string): Anchor {
  const start = texto.indexOf(fragmento);
  return createAnchor(texto, start, start + fragmento.length)!;
}

describe('capturar un ancla', () => {
  it('guarda la cita con contexto a ambos lados', () => {
    const anchor = anclarPrimera(DOC, 'remember little');
    expect(anchor.quote).toBe('remember little');
    expect(anchor.prefix).toContain('I read a lot and ');
    expect(anchor.suffix).toContain('. Notes end up');
  });

  it('rechaza una selección imposible', () => {
    expect(createAnchor(DOC, 10, 5)).toBeNull();
    expect(createAnchor(DOC, 5, 5)).toBeNull();
    expect(createAnchor(DOC, -1, 5)).toBeNull();
    expect(createAnchor(DOC, 0, DOC.length + 1)).toBeNull();
  });
});

describe('el texto no ha cambiado', () => {
  it('se reancla en el mismo sitio, sin buscar', () => {
    const anchor = anclarPrimera(DOC, 'remember little');
    const result = reanchor(anchor, DOC);

    expect(result.status).toBe('ANCHORED');
    expect(result.strategy).toBe('exact');
    expect(DOC.slice(result.start!, result.end!)).toBe('remember little');
  });
});

describe('el texto se ha desplazado', () => {
  it('editar el final no mueve los anclajes de arriba', () => {
    const anchor = anclarPrimera(DOC, 'remember little');
    const editado = `${DOC}\n# Risks\n\nNobody uses it.\n`;

    const result = reanchor(anchor, editado);
    expect(result.strategy).toBe('exact');
    expect(editado.slice(result.start!, result.end!)).toBe('remember little');
  });

  it('añadir texto al principio desplaza el ancla y se reencuentra', () => {
    const anchor = anclarPrimera(DOC, 'remember little');
    const editado = `# A brand new section\n\nSome text added on top.\n\n${DOC}`;

    const result = reanchor(anchor, editado);
    expect(result.status).toBe('ANCHORED');
    expect(editado.slice(result.start!, result.end!)).toBe('remember little');
  });
});

describe('citas ambiguas', () => {
  it('el contexto decide cuál de las dos apariciones es', () => {
    // «Notes end up scattered» aparece dos veces en el documento.
    const primera = DOC.indexOf('Notes end up scattered');
    const segunda = DOC.indexOf('Notes end up scattered', primera + 1);
    expect(segunda).toBeGreaterThan(primera);

    const anchor = createAnchor(DOC, segunda, segunda + 'Notes end up scattered'.length)!;
    const editado = DOC.replace('# The problem', '# The problem statement');

    const result = reanchor(anchor, editado);
    expect(result.status).toBe('ANCHORED');
    // Se queda en la segunda, no en la primera: el contexto lo distingue.
    expect(result.start).toBeGreaterThan(editado.indexOf('Who it'));
  });

  it('sin contexto útil, gana la aparición más cercana a donde estaba', () => {
    const segunda = DOC.indexOf(
      'Notes end up scattered',
      DOC.indexOf('Notes end up scattered') + 1,
    );
    const anchor = createAnchor(DOC, segunda, segunda + 'Notes end up scattered'.length)!;
    // Se destruye el contexto de alrededor para forzar la búsqueda por cita.
    const editado = DOC.replace(
      'People who read to learn. Notes',
      'Something else entirely. Notes',
    );

    const result = reanchor(anchor, editado);
    expect(result.status).toBe('ANCHORED');
    expect(editado.slice(result.start!, result.end!)).toBe('Notes end up scattered');
  });
});

describe('ediciones dentro del propio fragmento', () => {
  it('una errata corregida no rompe el anclaje', () => {
    const anchor = anclarPrimera(DOC, 'I read a lot and remember little');
    // Una letra cambiada dentro de la cita.
    const editado = DOC.replace('remember little', 'remembes little');

    const result = reanchor(anchor, editado);
    expect(result.status).toBe('ANCHORED');
    expect(result.strategy).toBe('fuzzy');
  });

  it('un fragmento reescrito de arriba abajo queda huérfano', () => {
    const anchor = anclarPrimera(DOC, 'I read a lot and remember little');
    const editado = DOC.replace(
      'I read a lot and remember little',
      'Knowledge disappears as fast as it arrives',
    );

    const result = reanchor(anchor, editado);
    // Ante la duda, huérfano: pegarlo a un párrafo que ya dice otra cosa haría
    // dudar de todos los demás comentarios.
    expect(result.status).toBe('ORPHANED');
    expect(result.start).toBeNull();
  });

  it('borrar el fragmento entero lo deja huérfano', () => {
    const anchor = anclarPrimera(DOC, 'Notes end up scattered');
    const editado = DOC.split('Notes end up scattered').join('');

    expect(reanchor(anchor, editado).status).toBe('ORPHANED');
  });
});

describe('un ancla huérfana revive si el texto vuelve (RF-809)', () => {
  it('restaurar una versión anterior recupera el anclaje', () => {
    const anchor = anclarPrimera(DOC, 'remember little');

    const borrado = DOC.replace('remember little', 'forget everything immediately');
    expect(reanchor(anchor, borrado).status).toBe('ORPHANED');

    // Se restaura el contenido original: el comentario vuelve a su sitio.
    const restaurado = reanchor(anchor, DOC);
    expect(restaurado.status).toBe('ANCHORED');
    expect(DOC.slice(restaurado.start!, restaurado.end!)).toBe('remember little');
  });
});

describe('no se ancla lejos de donde estaba', () => {
  it('un fragmento parecido al otro extremo del documento no cuenta', () => {
    const anchor = anclarPrimera(DOC, 'remember little');

    // El original desaparece y aparece algo parecido mucho más abajo.
    const editado =
      DOC.replace('remember little', 'forget everything') +
      '\n'.repeat(50) +
      'x'.repeat(2000) +
      '\nremembes little\n';

    const result = reanchor(anchor, editado);
    // Se encuentra por cita solo si es exacta; «remembes» no lo es, y la
    // búsqueda difusa no llega tan lejos.
    expect(result.status).toBe('ORPHANED');
  });
});
