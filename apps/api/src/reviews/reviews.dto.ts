import { ApiProperty } from '@nestjs/swagger';

/** Lo que costaría, como mucho, lo que va a leer un agente concreto. */
export class ReviewAgentEstimateDto {
  @ApiProperty({ format: 'uuid' }) agentId!: string;
  @ApiProperty() handle!: string;
  @ApiProperty() name!: string;

  @ApiProperty({ description: 'Entrada contada más salida al máximo: un techo, no una media' })
  estimatedTokens!: number;
}

/**
 * El techo de una revisión antes de pedirla (RF-1207, RF-1608).
 *
 * Se enseña **antes** de gastar, así que tiene que pasarse de largo y nunca
 * quedarse corto: quien confirma un número y recibe una factura mayor no vuelve
 * a confiar en el número.
 */
export class ReviewEstimateDto {
  @ApiProperty({ type: [ReviewAgentEstimateDto], description: 'Uno por agente activo' })
  agents!: ReviewAgentEstimateDto[];

  @ApiProperty({ description: 'La suma: lo que se confirma' }) totalTokens!: number;

  @ApiProperty() provider!: string;
  @ApiProperty() modelId!: string;

  @ApiProperty({ description: 'Qué versión se revisaría. Nunca la copia de trabajo' })
  versionNo!: number;

  @ApiProperty({ format: 'uuid' }) versionId!: string;

  @ApiProperty({
    description: 'Si entra en lo que queda de cupo este mes. Si no, la revisión no arranca',
  })
  fitsInQuota!: boolean;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Lo que queda del cupo del mes, o nulo si el proveedor no tiene cupo puesto',
  })
  remainingTokens!: number | null;
}
