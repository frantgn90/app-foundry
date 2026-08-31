import { describe, expect, it } from 'vitest';

import { ContextVerdict, explainContextFit, fitsInContext } from '../src/ai/context.js';

const modelo = (contextWindow: number, maxOutputTokens = 4_000) => ({
  contextWindow,
  maxOutputTokens,
});

describe('si lo que se quiere enviar cabe', () => {
  it('cabe cuando la entrada y la salida reservada suman menos que la ventana', () => {
    const fit = fitsInContext(1_000, 500, modelo(10_000));

    expect(fit.verdict).toBe(ContextVerdict.FITS);
    expect(fit.allowed).toBe(true);
    expect(fit.overflowTokens).toBe(0);
  });

  /*
   * La salida cuenta dentro de la ventana, no aparte. Ignorarlo hace que una
   * petición que «cabía» falle al llegar el modelo a la mitad de su respuesta.
   */
  it('la salida reservada cuenta dentro de la ventana', () => {
    expect(fitsInContext(9_800, 500, modelo(10_000)).allowed).toBe(false);
    expect(fitsInContext(9_800, 100, modelo(10_000)).allowed).toBe(true);
  });

  it('dice cuánto sobra, que es lo que hay que acortar', () => {
    const fit = fitsInContext(9_000, 2_000, modelo(10_000));

    expect(fit.verdict).toBe(ContextVerdict.DOES_NOT_FIT);
    expect(fit.overflowTokens).toBe(1_000);
  });

  it('la salida se acota al máximo del modelo, aunque se pida más', () => {
    const fit = fitsInContext(100, 999_999, modelo(1_000_000, 8_000));

    expect(fit.outputTokens).toBe(8_000);
  });

  /*
   * Groq no tipa la ventana de contexto en su SDK, así que puede llegar sin
   * ella. Negarse por no saber dejaría inservible a ese modelo; callar sería
   * fingir que se comprobó.
   */
  it('sin ventana declarada se deja pasar, pero se dice', () => {
    const fit = fitsInContext(50_000, 1_000, modelo(0));

    expect(fit.verdict).toBe(ContextVerdict.UNKNOWN_WINDOW);
    expect(fit.allowed).toBe(true);
  });

  it('justo en el límite, cabe', () => {
    expect(fitsInContext(9_500, 500, modelo(10_000)).allowed).toBe(true);
    expect(fitsInContext(9_501, 500, modelo(10_000)).allowed).toBe(false);
  });
});

describe('qué se le cuenta a quien se topa con el límite', () => {
  it('cuánto sobra y qué puede hacer', () => {
    const mensaje = explainContextFit(fitsInContext(9_000, 2_000, modelo(10_000)), 'modelo-x');

    expect(mensaje).toContain('1000');
    expect(mensaje).toMatch(/acórtalo|ventana/i);
  });

  it('que no se pudo comprobar, cuando no se pudo', () => {
    const mensaje = explainContextFit(fitsInContext(10, 10, modelo(0)), 'modelo-x');

    expect(mensaje).toMatch(/no declara/i);
  });

  it('nada, cuando cabe', () => {
    expect(explainContextFit(fitsInContext(10, 10, modelo(1_000)), 'modelo-x')).toBe('');
  });
});
