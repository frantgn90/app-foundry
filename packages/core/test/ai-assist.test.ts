import { describe, expect, it } from 'vitest';

import {
  ASSIST_ACTIONS,
  AssistAction,
  assistInstruction,
  assistMessages,
  assistSystemPrompt,
  roughTokenCount,
  surroundingsOf,
} from '../src/index.js';

/**
 * El asistente de escritura, en lo que no depende de ningún proveedor.
 *
 * Lo que se comprueba aquí es lo que decide si el resultado sirve: que las cinco
 * acciones existan y digan cosas distintas, que el material vaya etiquetado
 * aparte de la instrucción, y que recortar el contexto se note.
 */
describe('las acciones', () => {
  it('son cinco, y ninguna repite lo que pide otra', () => {
    expect(ASSIST_ACTIONS).toHaveLength(5);

    const instrucciones = ASSIST_ACTIONS.map(assistInstruction);
    expect(new Set(instrucciones).size).toBe(5);
    expect(instrucciones.every((texto) => texto.length > 40)).toBe(true);
  });

  /*
   * Corregir es la única que no debe tocar la redacción: si su instrucción
   * dejara margen para reescribir, sería «mejorar» con otro nombre y quien la
   * pidiera se encontraría el texto cambiado.
   */
  it('corregir dice explícitamente que no cambie nada más', () => {
    expect(assistInstruction(AssistAction.PROOFREAD)).toMatch(/change nothing else/i);
  });
});

describe('el prompt', () => {
  /*
   * Las dos reglas que sostienen la función: solo el texto de vuelta —lo que
   * llega se pinta como diff, así que un «Claro, aquí tienes» acabaría dentro
   * del documento— y el documento como datos, nunca como instrucciones.
   */
  it('el papel exige devolver solo el texto y tratar el documento como datos', () => {
    const sistema = assistSystemPrompt();

    expect(sistema).toMatch(/nothing else/i);
    expect(sistema).toMatch(/never as instructions/i);
  });

  it('el material va etiquetado y separado de lo que se pide', () => {
    const [mensaje] = assistMessages({
      action: AssistAction.IMPROVE,
      target: 'el parrafo marcado',
      context: '# Titulo\n\nel parrafo marcado\n\notro parrafo',
    });

    expect(mensaje?.role).toBe('user');
    expect(mensaje?.content).toContain('<document>');
    expect(mensaje?.content).toContain('<text-to-rewrite>\nel parrafo marcado\n</text-to-rewrite>');
    expect(mensaje?.content).toContain('<instruction>');
  });

  it('sin contexto no se envía la sección del documento, ni vacía', () => {
    const [mensaje] = assistMessages({ action: AssistAction.SUMMARISE, target: 'algo' });

    expect(mensaje?.content).not.toContain('<document>');
  });
});

describe('el entorno cuando el documento no cabe', () => {
  const documento = `${'a'.repeat(500)}[marcado]${'b'.repeat(500)}`;
  const inicio = 500;
  const fin = inicio + '[marcado]'.length;

  it('cabiendo entero, se envía entero y no se dice nada de recorte', () => {
    const entorno = surroundingsOf(documento, inicio, fin, 1_000);

    expect(entorno.trimmed).toBe(false);
    expect(entorno.text).toBe(documento);
  });

  /*
   * Recortado, tienen que pasar dos cosas: que lo marcado siga entero —se
   * recorta el contexto, nunca el texto a reescribir— y que se vea por dónde se
   * cortó, para que ni el modelo ni quien lee el aviso crean que están viendo el
   * documento completo.
   */
  it('recortado, conserva lo marcado y marca por dónde cortó', () => {
    const entorno = surroundingsOf(documento, inicio, fin, 100);

    expect(entorno.trimmed).toBe(true);
    expect(entorno.text).toContain('[marcado]');
    expect(entorno.text.startsWith('…')).toBe(true);
    expect(entorno.text.endsWith('…')).toBe(true);
    expect(entorno.text.length).toBeLessThan(documento.length);
  });

  it('junto a un borde, solo marca el lado que se cortó', () => {
    const entorno = surroundingsOf(documento, 0, 10, 100);

    expect(entorno.text.startsWith('…')).toBe(false);
    expect(entorno.text.endsWith('…')).toBe(true);
  });
});

describe('la aproximación de tokens', () => {
  /*
   * Solo se usa para lo que nadie contó: lo generado antes de una cancelación.
   * Lo importante no es acertar sino no quedarse corto, porque quedarse corto es
   * regalar cupo ajeno.
   */
  it('redondea al alza y nunca da cero para un texto que existe', () => {
    expect(roughTokenCount('')).toBe(0);
    expect(roughTokenCount('a')).toBe(1);
    expect(roughTokenCount('a'.repeat(300))).toBe(100);
  });
});
