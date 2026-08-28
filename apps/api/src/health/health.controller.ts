import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { HealthService, type ReadinessReport } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * ¿Está vivo el proceso?
   *
   * No consulta dependencias a propósito: si Postgres se cae, el orquestador no
   * debe reiniciar la API, que está perfectamente sana. Eso es lo que separa
   * `live` de `ready`.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness: el proceso responde' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** ¿Puede atender peticiones? Aquí sí se comprueban Postgres y Redis. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: las dependencias responden' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReport> {
    const report = await this.health.check();
    // 503 cuando algo está caído: un balanceador debe poder decidir mirando el
    // código de estado, sin interpretar el cuerpo.
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
