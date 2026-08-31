import { describe, expect, it } from 'vitest';

import { AiTask } from '../src/ai/enums.js';
import type { ProviderCapabilities } from '../src/ai/provider.js';
import { capabilitiesUsedBy, supportForTask } from '../src/ai/tasks.js';

const TODO: ProviderCapabilities = {
  streaming: true,
  schemaOutput: true,
  webSearch: true,
  exactTokenCount: true,
};

const capacidades = (parcial: Partial<ProviderCapabilities>): ProviderCapabilities => ({
  ...TODO,
  ...parcial,
});

describe('qué le exige cada tarea a un proveedor', () => {
  it('con todas las capacidades, todas las tareas corren enteras', () => {
    for (const task of Object.values(AiTask)) {
      const support = supportForTask(task, TODO);
      expect(support).toEqual({ supported: true, missing: [], degraded: [] });
    }
  });

  it('sin salida con esquema no se generan ideas ni se revisa', () => {
    const sinEsquema = capacidades({ schemaOutput: false });

    expect(supportForTask(AiTask.IDEA_GENERATION, sinEsquema).supported).toBe(false);
    expect(supportForTask(AiTask.AGENT_REVIEW, sinEsquema).missing).toEqual(['schemaOutput']);
  });

  it('sin salida con esquema el asistente y las respuestas siguen funcionando', () => {
    const sinEsquema = capacidades({ schemaOutput: false });

    expect(supportForTask(AiTask.TEXT_ASSIST, sinEsquema).supported).toBe(true);
    expect(supportForTask(AiTask.AGENT_REPLY, sinEsquema).supported).toBe(true);
  });

  /*
   * La distinción que importa: sin búsqueda web las ideas se generan, pero
   * dejan de estar fundamentadas y hay que avisarlo (RF-1305). No es lo mismo
   * que no poder ofrecerlas.
   */
  it('sin búsqueda web las ideas se degradan, no se impiden', () => {
    const sinBusqueda = capacidades({ webSearch: false });

    expect(supportForTask(AiTask.IDEA_GENERATION, sinBusqueda)).toEqual({
      supported: true,
      missing: [],
      degraded: ['webSearch'],
    });
  });

  it('la búsqueda web no afecta a ninguna otra tarea', () => {
    const sinBusqueda = capacidades({ webSearch: false });

    for (const task of [AiTask.TEXT_ASSIST, AiTask.AGENT_REVIEW, AiTask.AGENT_REPLY]) {
      expect(supportForTask(task, sinBusqueda).degraded).toEqual([]);
    }
  });

  it('cada tarea declara qué capacidades usa', () => {
    expect(capabilitiesUsedBy(AiTask.IDEA_GENERATION)).toEqual(['schemaOutput', 'webSearch']);
    expect(capabilitiesUsedBy(AiTask.TEXT_ASSIST)).toEqual([]);
  });
});
