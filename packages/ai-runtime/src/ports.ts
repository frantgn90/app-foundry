import type { NotificationType } from '@app-foundry/core';

/**
 * Lo que el paso común de invocación mide.
 *
 * Un puerto y no el servicio de métricas de la API: aquí solo hacen falta tres
 * llamadas, y depender del servicio entero traería el registro de todas las
 * métricas del producto a un paquete que no las emite.
 */
export interface AiMetricsPort {
  invocacionIa(datos: {
    provider: string;
    model: string;
    task: string;
    outcome: string;
    errorKind?: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    ttftMs?: number;
  }): void;
  cortacircuitosAbierto(provider: string): void;
  cortacircuitosCerrado(provider: string): void;
}

/**
 * Cómo se avisa a una persona desde aquí.
 *
 * Son dos avisos y solo dos: que un modelo asignado dejó de estar disponible y
 * que el cupo se acerca a su techo (RF-1205, RF-1107). Todo lo demás que se
 * notifica en el producto ocurre en la API y no pasa por aquí.
 */
export interface AiNotifierPort {
  emit(aviso: {
    type: NotificationType;
    entorno: { actor: string; destinatario?: string | undefined };
    workspaceId: string;
    appId?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<void>;
}
