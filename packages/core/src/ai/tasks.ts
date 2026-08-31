import { AiTask } from './enums.js';
import type { CapabilityName, ProviderCapabilities } from './provider.js';

/**
 * Qué le exige cada tarea a un proveedor.
 *
 * Es la regla que permite dibujar la interfaz a partir de las capacidades
 * declaradas y no de una lista de proveedores conocidos (RF-1008): una función
 * que necesita algo que el modelo asignado no tiene, o no se ofrece, o se ofrece
 * avisando de en qué queda coja.
 */
interface TaskNeeds {
  /** Sin esto la tarea no se puede ofrecer. */
  readonly required: readonly CapabilityName[];
  /** Sin esto la tarea corre, pero peor, y hay que decirlo. */
  readonly improvedBy: readonly CapabilityName[];
}

const NEEDS: Readonly<Record<AiTask, TaskNeeds>> = {
  /*
   * Las propuestas tienen que salir comparables entre sí, y eso es una lista con
   * forma, no prosa (RF-1303). La búsqueda web no es obligatoria: sin ella se
   * generan igual, pero dejan de estar fundamentadas en el mercado de hoy y el
   * producto tiene que decirlo en vez de aparentar lo contrario (RF-1305).
   */
  [AiTask.IDEA_GENERATION]: { required: ['schemaOutput'], improvedBy: ['webSearch'] },

  /* Devuelve texto para un diff. No necesita nada especial. */
  [AiTask.TEXT_ASSIST]: { required: [], improvedBy: [] },

  /*
   * Una revisión devuelve pares de cita y comentario para anclarlos al
   * documento (RF-1606). Sin esquema garantizado, cada cita habría que
   * rescatarla de la prosa, y una cita mal recortada no ancla.
   */
  [AiTask.AGENT_REVIEW]: { required: ['schemaOutput'], improvedBy: [] },

  /* Contestar en un hilo es escribir un comentario: texto y ya. */
  [AiTask.AGENT_REPLY]: { required: [], improvedBy: [] },
};

export interface TaskSupport {
  /** Si es falso, la tarea no se ofrece con ese modelo. */
  readonly supported: boolean;
  /** Capacidades que faltan y lo impiden. */
  readonly missing: readonly CapabilityName[];
  /** Capacidades que faltan y solo empobrecen el resultado. */
  readonly degraded: readonly CapabilityName[];
}

/**
 * Si un proveedor puede atender una tarea, y con qué merma.
 *
 * Devuelve las tres cosas por separado a propósito: la interfaz necesita
 * distinguir «esto no se puede» de «esto se puede pero peor», y son mensajes
 * distintos para el usuario.
 */
export function supportForTask(task: AiTask, capabilities: ProviderCapabilities): TaskSupport {
  const needs = NEEDS[task];
  const missing = needs.required.filter((name) => !capabilities[name]);
  const degraded = needs.improvedBy.filter((name) => !capabilities[name]);
  return { supported: missing.length === 0, missing, degraded };
}

/** Las capacidades que alguna tarea exige o aprovecha. Útil para explicar un catálogo. */
export function capabilitiesUsedBy(task: AiTask): readonly CapabilityName[] {
  const needs = NEEDS[task];
  return [...needs.required, ...needs.improvedBy];
}
