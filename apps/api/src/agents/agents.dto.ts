import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { AGENT_HANDLE_PATTERN, APP_COLORS, APP_EMOJIS } from '@app-foundry/core';

const PROVIDERS = ['ANTHROPIC', 'GROQ'] as const;

/**
 * El modelo propio de una plantilla o de un agente (RF-1104).
 *
 * Nulo es lo normal: entonces manda el que el workspace tenga asignado al tipo
 * de tarea. Va entero o no va, igual que en la base de datos: un proveedor sin
 * modelo no dice cuál y un modelo sin proveedor no identifica a nadie.
 */
export class AgentModelDto {
  @ApiProperty({ enum: PROVIDERS })
  @IsIn(PROVIDERS)
  provider!: (typeof PROVIDERS)[number];

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  modelId!: string;
}

export class AgentTemplateDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Con lo que se le llama en un comentario' }) handle!: string;
  @ApiProperty() iconEmoji!: string;
  @ApiProperty() iconColor!: string;
  @ApiProperty({ description: 'La personalidad, en texto' }) prompt!: string;

  @ApiProperty({
    type: AgentModelDto,
    nullable: true,
    description: 'Modelo propio. Nulo si usa el asignado a la tarea',
  })
  model!: AgentModelDto | null;

  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CreateAgentTemplateDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  name!: string;

  /**
   * La forma del handle no es libre: tiene que poder escribirse como `@algo` en
   * un comentario y que el extractor de menciones lo reconozca. Un handle que
   * no case con ese patrón daría una plantilla imposible de invocar, y el fallo
   * no se vería hasta que alguien la mencionara sin respuesta.
   */
  @ApiProperty({ description: 'Letras, números y guiones interiores; hasta 39 caracteres' })
  @IsString()
  @Matches(AGENT_HANDLE_PATTERN, {
    message: 'handle must be letters, digits and inner hyphens, up to 39 characters',
  })
  handle!: string;

  @ApiProperty({ enum: APP_EMOJIS })
  @IsIn(APP_EMOJIS as readonly string[])
  iconEmoji!: string;

  @ApiProperty({ enum: APP_COLORS })
  @IsIn(APP_COLORS as readonly string[])
  iconColor!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 8000)
  prompt!: string;

  @ApiPropertyOptional({ type: AgentModelDto, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => AgentModelDto)
  model?: AgentModelDto | null;
}

/** Todo opcional: se cambia lo que se manda y lo demás se queda como estaba. */
export class UpdateAgentTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(AGENT_HANDLE_PATTERN, {
    message: 'handle must be letters, digits and inner hyphens, up to 39 characters',
  })
  handle?: string;

  @ApiPropertyOptional({ enum: APP_EMOJIS })
  @IsOptional()
  @IsIn(APP_EMOJIS as readonly string[])
  iconEmoji?: string;

  @ApiPropertyOptional({ enum: APP_COLORS })
  @IsOptional()
  @IsIn(APP_COLORS as readonly string[])
  iconColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 8000)
  prompt?: string;

  @ApiPropertyOptional({ type: AgentModelDto, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @ValidateNested()
  @Type(() => AgentModelDto)
  model?: AgentModelDto | null;
}

/** Una entrada del catálogo de fábrica, tal como se ofrece (RF-1513). */
export class CatalogAgentDto {
  @ApiProperty({ description: 'Clave estable de la entrada, para adoptarla' }) key!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Handle sugerido' }) handle!: string;
  @ApiProperty() iconEmoji!: string;
  @ApiProperty() iconColor!: string;
  @ApiProperty({ description: 'Una línea para elegir sin leerse el prompt entero' })
  summary!: string;

  @ApiProperty({ description: 'El prompt que se copiaría al adoptarla' }) prompt!: string;
}
