import { describe, expect, it } from 'vitest';

import { ReasoningSplitter, splitReasoning } from '../src/index.js';

/**
 * Separar lo que el modelo piensa de lo que responde.
 *
 * Lo que se comprueba aquí es lo que decide si el documento de alguien acaba con
 * la deliberación de un modelo dentro: que se reconozca partida en trozos, que
 * lo que no era una etiqueta no se pierda, y que un bloque sin cerrar no se
 * cuele como si fuera respuesta.
 */
describe('de una vez', () => {
  it('lo de dentro es razonamiento y lo de fuera es la respuesta', () => {
    const { text, reasoning } = splitReasoning(
      '<think>Primero pienso esto.</think>El parrafo mejorado.',
    );

    expect(text).toBe('El parrafo mejorado.');
    expect(reasoning).toBe('Primero pienso esto.');
  });

  it('sin razonamiento, el texto pasa intacto', () => {
    expect(splitReasoning('Un texto normal y corriente.')).toEqual({
      text: 'Un texto normal y corriente.',
      reasoning: '',
    });
  });

  it('reconoce las dos formas, y no confunde una con otra', () => {
    /*
     * `<thinking>` empieza donde empezaría `<think>`: quedarse con la corta
     * dejaría un «ing>» suelto en mitad del documento.
     */
    const { text, reasoning } = splitReasoning('<thinking>dudo</thinking>respuesta');

    expect(text).toBe('respuesta');
    expect(reasoning).toBe('dudo');
  });

  it('varios bloques se juntan, y el texto de en medio se conserva', () => {
    const { text, reasoning } = splitReasoning('<think>a</think>uno<think>b</think>dos');

    expect(text).toBe('unodos');
    expect(reasoning).toBe('ab');
  });

  /*
   * Pasa cuando el modelo se queda sin tokens pensando. Lo que hay dentro sigue
   * siendo razonamiento: darlo por respuesta sería meter la deliberación entera
   * en el documento, que es lo peor que se puede hacer con ella.
   */
  it('un bloque sin cerrar no se convierte en respuesta', () => {
    const { text, reasoning } = splitReasoning('Antes.<think>me quede a medias');

    expect(text).toBe('Antes.');
    expect(reasoning).toBe('me quede a medias');
  });
});

describe('llegando en trozos', () => {
  const separar = (trozos: string[]) => {
    const separador = new ReasoningSplitter();
    let text = '';
    let reasoning = '';
    for (const trozo of trozos) {
      const parte = separador.push(trozo);
      text += parte.text;
      reasoning += parte.reasoning;
    }
    const ultimo = separador.flush();
    return { text: text + ultimo.text, reasoning: reasoning + ultimo.reasoning };
  };

  /*
   * El caso que obliga a que esto sea incremental: la etiqueta se parte por
   * donde quiera. Buscarla en cada trozo por separado no la encontraría nunca.
   */
  it('una etiqueta partida entre dos trozos se reconoce igual', () => {
    expect(separar(['<thi', 'nk>pienso</th', 'ink>respondo'])).toEqual({
      text: 'respondo',
      reasoning: 'pienso',
    });
  });

  it('partida carácter a carácter, también', () => {
    const entero = '<think>pienso</think>respondo';
    expect(separar([...entero])).toEqual({ text: 'respondo', reasoning: 'pienso' });
  });

  /*
   * Y lo retenido que al final no era una etiqueta tiene que salir: si no, un
   * documento que acabe en «<» perdería ese carácter sin que nadie se entere.
   */
  it('lo que parecía una etiqueta y no lo era no se pierde', () => {
    expect(separar(['a < b, y ', 'c <thin'])).toEqual({ text: 'a < b, y c <thin', reasoning: '' });
  });

  it('el reparto es el mismo llegue como llegue', () => {
    const entero = 'Hola.<think>dudo un poco</think> Adios.';
    const porTrozos = separar(['Hola.<thi', 'nk>dudo un', ' poco</think> Ad', 'ios.']);

    expect(porTrozos).toEqual(splitReasoning(entero));
  });
});

describe('el aviso de que se quedó pensando', () => {
  it('se sabe que el bloque quedó abierto', () => {
    const separador = new ReasoningSplitter();
    separador.push('<think>y aqui se corto');

    expect(separador.unterminated).toBe(true);
  });

  it('y que no, cuando cerró', () => {
    const separador = new ReasoningSplitter();
    separador.push('<think>ya esta</think>listo');

    expect(separador.unterminated).toBe(false);
  });
});
