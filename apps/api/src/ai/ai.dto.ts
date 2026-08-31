import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, Length } from 'class-validator';

import { AiProvider, AiTask } from '@app-foundry/core';

const PROVEEDORES = Object.values(AiProvider);
const TAREAS = Object.values(AiTask);

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

/** Los ajustes de IA del workspace, lo que no es de un proveedor concreto. */
export class AiSettingsDto {
  @ApiProperty({ description: 'Interruptor general (RF-1012)' })
  enabled!: boolean;

  @ApiProperty({ type: AiEgressConsentDto })
  consent!: AiEgressConsentDto;
}

export class SetAiEnabledDto {
  @ApiProperty({ description: 'Apagar o encender toda la IA del workspace' })
  @IsBoolean()
  enabled!: boolean;
}

/** Un modelo del catálogo del proveedor (RF-1007). Sin precio: no lo publica nadie. */
export class AiModelDto {
  @ApiProperty({ enum: PROVEEDORES })
  provider!: AiProvider;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ description: 'Cero significa que el proveedor no lo declara' })
  contextWindow!: number;

  @ApiProperty({ description: 'Cero significa que el proveedor no lo declara' })
  maxOutputTokens!: number;

  @ApiProperty({ description: 'Si el proveedor lo sigue ofreciendo' })
  available!: boolean;
}

/**
 * Qué modelo atiende una tarea, y con qué merma si la tiene.
 *
 * `supported` y `degraded` salen de comparar lo que la tarea exige con lo que el
 * proveedor declara (RF-1008): es lo que permite dibujar la interfaz desde las
 * capacidades y no desde una lista de proveedores conocidos.
 */
export class AiTaskAssignmentDto {
  @ApiProperty({ enum: TAREAS })
  task!: AiTask;

  @ApiProperty({ enum: PROVEEDORES, nullable: true })
  provider!: AiProvider | null;

  @ApiProperty({ nullable: true })
  modelId!: string | null;

  @ApiProperty({ description: 'Si con lo asignado la tarea se puede ofrecer' })
  supported!: boolean;

  @ApiProperty({ type: [String], description: 'Capacidades que faltan y lo impiden' })
  missing!: string[];

  @ApiProperty({ type: [String], description: 'Capacidades que faltan y solo la empobrecen' })
  degraded!: string[];
}

export class AssignTaskModelDto {
  @ApiProperty({ enum: PROVEEDORES })
  @IsIn(PROVEEDORES as readonly string[])
  provider!: AiProvider;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  modelId!: string;
}
