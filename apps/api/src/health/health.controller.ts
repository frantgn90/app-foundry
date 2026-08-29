import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { DependencyCheckDto, LivenessDto, ReadinessReportDto } from './health.dto.js';
import { Public } from '../auth/public.decorator.js';
import { HealthService } from './health.service.js';

// DependencyCheckDto solo aparece dentro de un mapa, así que hay que
// registrarlo a mano para que llegue al contrato.
@ApiExtraModels(DependencyCheckDto)
// La salud la consulta un orquestador, que no tiene sesión.
@Public()
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
  @ApiOkResponse({ type: LivenessDto })
  live(): LivenessDto {
    return { status: 'ok' };
  }

  /** ¿Puede atender peticiones? Aquí sí se comprueban Postgres y Redis. */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: las dependencias responden' })
  @ApiOkResponse({ type: ReadinessReportDto })
  @ApiServiceUnavailableResponse({
    type: ReadinessReportDto,
    description: 'Alguna dependencia falla',
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessReportDto> {
    const report = await this.health.check();
    // 503 cuando algo está caído: un balanceador debe poder decidir mirando el
    // código de estado, sin interpretar el cuerpo.
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
