import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';

import { AiProvider } from '@app-foundry/core';

const PROVEEDORES = Object.values(AiProvider);

export class ProviderCapabilitiesDto {
  @ApiProperty() streaming!: boolean;
  @ApiProperty({ description: 'Garantiza que la respuesta cumple un esquema declarado' })
  schemaOutput!: boolean;
  @ApiProperty({ description: 'Busca en la web desde su propia infraestructura' })
  webSearch!: boolean;
  @ApiProperty({ description: 'Cuenta los tokens por API en vez de obligar a aproximar' })
  exactTokenCount!: boolean;
}

/**
 * Un proveedor configurado, tal como lo ve quien pregunta.
 *
 * Los campos de dueño van marcados como opcionales porque **no se envían** a
 * quien no lo es (RF-1002). No es un detalle de presentación: el cupo y el
 * momento de la última verificación son asuntos de quien paga.
 */
export class AiProviderDto {
  @ApiProperty({ enum: PROVEEDORES })
  provider!: AiProvider;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED', 'INVALID'] })
  status!: 'ACTIVE' | 'DISABLED' | 'INVALID';

  @ApiProperty({ type: ProviderCapabilitiesDto })
  capabilities!: ProviderCapabilitiesDto;

  @ApiPropertyOptional({
    description: 'Últimos caracteres de la clave, para reconocerla. Solo para el dueño',
  })
  credentialHint?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cupo mensual de tokens. Solo para el dueño',
  })
  monthlyTokenQuota?: number | null;

  @ApiPropertyOptional({ description: 'Porcentaje del cupo al que se avisa. Solo para el dueño' })
  quotaAlertPct?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Solo para el dueño' })
  verifiedAt?: string | null;
}

export class ConfigureProviderDto {
  @ApiProperty({
    description: 'La clave del proveedor. Se cifra al guardarla y no vuelve a salir de aquí',
    minLength: 8,
    maxLength: 400,
  })
  @IsString()
  @Length(8, 400)
  apiKey!: string;
}

export class SetProviderStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}

/**
 * Si en este workspace se ha aceptado que el contenido salga a un tercero
 * (RF-1011).
 *
 * Es un hecho del workspace, no de cada proveedor: lo que se consiente es que
 * el texto de las apps deje de estar solo aquí.
 */
export class AiEgressConsentDto {
  @ApiProperty()
  accepted!: boolean;

  @ApiProperty({ nullable: true })
  acceptedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'Handle de quien lo aceptó' })
  acceptedBy!: string | null;
}
