import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

/**
 * DTOs de respuesta de las comprobaciones de salud.
 *
 * Sin ellos el OpenAPI describe las rutas pero no lo que devuelven, y el
 * cliente generado recibe `never`: un contrato a medias es peor que ninguno,
 * porque parece que funciona.
 */
export class DependencyCheckDto {
  @ApiProperty({ enum: ['up', 'down'], description: 'Estado de la dependencia' })
  status!: 'up' | 'down';

  @ApiProperty({ description: 'Tiempo de respuesta en milisegundos', example: 12 })
  latencyMs!: number;

  @ApiProperty({ required: false, description: 'Motivo del fallo, si lo hubo' })
  error?: string;
}

export class ReadinessReportDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status!: 'ok' | 'degraded';

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(DependencyCheckDto) },
    description: 'Una entrada por dependencia comprobada',
  })
  checks!: Record<string, DependencyCheckDto>;
}

export class LivenessDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}
