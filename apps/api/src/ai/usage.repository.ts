import { Injectable } from '@nestjs/common';

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

import type { AiProvider } from '@app-foundry/core';
import { aiInvocations, users } from '@app-foundry/db';

import { currentTx } from '../database/request-context.js';

/**
 * Lo que dice la tabla de invocaciones, que es la verdad del consumo.
 *
 * Va aparte del contador para que este pueda probarse sin base de datos delante
 * y, sobre todo, para que quede claro quién manda: el contador de Redis se
 * reconstruye de aquí, nunca al revés (TRD v2 §9.1).
 */
@Injectable()
export class AiUsageRepository {
  /** Tokens consumidos por un proveedor en un mes, contando entrada y salida. */
  async spentInMonth(workspaceId: string, provider: AiProvider, month: string): Promise<number> {
    const desde = new Date(`${month}-01T00:00:00.000Z`);
    const hasta = new Date(desde);
    hasta.setUTCMonth(hasta.getUTCMonth() + 1);

    const [fila] = await currentTx()
      .select({
        total: sql<number>`coalesce(sum(${aiInvocations.inputTokens} + ${aiInvocations.outputTokens}), 0)::int`,
      })
      .from(aiInvocations)
      .where(
        and(
          eq(aiInvocations.workspaceId, workspaceId),
          eq(aiInvocations.provider, provider),
          gte(aiInvocations.createdAt, desde),
          lt(aiInvocations.createdAt, hasta),
        ),
      );

    return fila?.total ?? 0;
  }

  /** Consumo por tipo de tarea. */
  byTask(workspaceId: string, month: string): Promise<UsageBreakdownRow[]> {
    return this.breakdown(workspaceId, month, aiInvocations.task);
  }

  /** Consumo por modelo. */
  byModel(workspaceId: string, month: string): Promise<UsageBreakdownRow[]> {
    return this.breakdown(workspaceId, month, aiInvocations.modelId);
  }

  /** Consumo por proveedor. */
  byProvider(workspaceId: string, month: string): Promise<UsageBreakdownRow[]> {
    return this.breakdown(workspaceId, month, aiInvocations.provider);
  }

  /**
   * Consumo por persona.
   *
   * Se agrupa por handle y no por identificador porque la lista es para leerla.
   * Un miembro solo se ve a sí mismo, y no por un filtro de aquí sino porque la
   * política no le devuelve las filas de los demás.
   */
  async byMember(workspaceId: string, month: string): Promise<UsageBreakdownRow[]> {
    const { desde, hasta } = monthWindow(month);

    const filas = await currentTx()
      .select({
        key: sql<string>`coalesce(${users.handle}, 'desconocido')`,
        inputTokens: sql<number>`sum(${aiInvocations.inputTokens})::int`,
        outputTokens: sql<number>`sum(${aiInvocations.outputTokens})::int`,
        invocations: sql<number>`count(*)::int`,
      })
      .from(aiInvocations)
      .leftJoin(users, eq(users.id, aiInvocations.actorUserId))
      .where(
        and(
          eq(aiInvocations.workspaceId, workspaceId),
          gte(aiInvocations.createdAt, desde),
          lt(aiInvocations.createdAt, hasta),
        ),
      )
      .groupBy(sql`coalesce(${users.handle}, 'desconocido')`)
      .orderBy(desc(sql`sum(${aiInvocations.inputTokens} + ${aiInvocations.outputTokens})`));

    return filas;
  }

  private async breakdown(
    workspaceId: string,
    month: string,
    columna:
      typeof aiInvocations.task | typeof aiInvocations.modelId | typeof aiInvocations.provider,
  ): Promise<UsageBreakdownRow[]> {
    const { desde, hasta } = monthWindow(month);

    return currentTx()
      .select({
        key: sql<string>`${columna}::text`,
        inputTokens: sql<number>`sum(${aiInvocations.inputTokens})::int`,
        outputTokens: sql<number>`sum(${aiInvocations.outputTokens})::int`,
        invocations: sql<number>`count(*)::int`,
      })
      .from(aiInvocations)
      .where(
        and(
          eq(aiInvocations.workspaceId, workspaceId),
          gte(aiInvocations.createdAt, desde),
          lt(aiInvocations.createdAt, hasta),
        ),
      )
      .groupBy(columna)
      .orderBy(desc(sql`sum(${aiInvocations.inputTokens} + ${aiInvocations.outputTokens})`));
  }
}

/** Una línea del desglose: por tarea, por modelo o por persona. */
export interface UsageBreakdownRow {
  key: string;
  inputTokens: number;
  outputTokens: number;
  invocations: number;
}

/**
 * El desglose del mes.
 *
 * No lleva filtro por usuario **a propósito**: la Row-Level Security ya devuelve
 * a cada uno lo que le toca —lo suyo a un miembro, todo lo del workspace a su
 * dueño (RF-1208)—. Añadir aquí un `where` duplicaría esa regla y se arriesgaría
 * a que las dos copias divergieran.
 */
export interface MonthWindow {
  readonly desde: Date;
  readonly hasta: Date;
}

export function monthWindow(month: string): MonthWindow {
  const desde = new Date(`${month}-01T00:00:00.000Z`);
  const hasta = new Date(desde);
  hasta.setUTCMonth(hasta.getUTCMonth() + 1);
  return { desde, hasta };
}
