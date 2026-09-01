import { Injectable } from '@nestjs/common';

import type { AiUsageDto } from './ai.dto.js';
import { AiProvidersService } from './providers.service.js';
import { AiQuotaService } from './quota.service.js';
import { AiUsageRepository } from './usage.repository.js';

/**
 * Qué se ha consumido este mes (RF-1208).
 *
 * Se mide en tokens, con entrada y salida por separado, y no en dinero: las
 * tarifas son un dato de terceros que cambia sin avisarnos y el producto no debe
 * aparentar una precisión que no tiene (D-37).
 */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly usage: AiUsageRepository,
    private readonly providers: AiProvidersService,
    private readonly quota: AiQuotaService,
  ) {}

  async ofMonth(workspaceId: string, userId: string, now = Date.now()): Promise<AiUsageDto> {
    const month = AiQuotaService.month(now);

    /*
     * Los desgloses no llevan filtro por usuario: la política de la tabla ya
     * devuelve a cada uno lo suyo y al dueño todo lo de su workspace. Filtrar
     * aquí además duplicaría la regla y se arriesgaría a que divergieran.
     */
    /*
     * Una detrás de otra, no en paralelo: las tres van por la conexión de la
     * transacción de la petición, y lanzarlas a la vez es usar una conexión que
     * ya está ocupada. `pg` lo avisa hoy y lo prohibirá mañana.
     */
    const byTask = await this.usage.byTask(workspaceId, month);
    const byModel = await this.usage.byModel(workspaceId, month);
    const byMember = await this.usage.byMember(workspaceId, month);

    return {
      month,
      /* El cupo es asunto de quien paga, así que solo lo ve él. */
      providers: await this.providerUsage(workspaceId, userId, now),
      byTask,
      byModel,
      byMember,
    };
  }

  private async providerUsage(
    workspaceId: string,
    userId: string,
    now: number,
  ): Promise<AiUsageDto['providers']> {
    if (!(await this.providers.isOwnerOf(workspaceId, userId))) return [];

    const configurados = await this.providers.list(workspaceId, userId);

    return Promise.all(
      configurados.map(async (p) => {
        const estado = await this.quota.state(
          { workspaceId, provider: p.provider },
          p.monthlyTokenQuota ?? null,
          now,
        );
        return {
          provider: p.provider,
          quota: estado.quota,
          spentTokens: estado.spent,
          reservedTokens: estado.reserved,
        };
      }),
    );
  }
}
