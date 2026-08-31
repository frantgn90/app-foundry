import { Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql } from 'drizzle-orm';

import type { AiProvider } from '@app-foundry/core';
import { aiInvocations } from '@app-foundry/db';

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
}
