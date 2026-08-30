import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
} from 'class-validator';

import { type AccessLevel, APP_COLORS, APP_EMOJIS } from '@app-foundry/core';

const APP_STATUSES = ['IDEA', 'DEFINING', 'IN_DEVELOPMENT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'];
const ACCESS_LEVELS = ['PRIVATE', 'WORKSPACE_READ', 'WORKSPACE_WRITE'];

export class AppIconDto {
  @ApiProperty({ description: 'Emoji de la selección curada' })
  emoji!: string;

  @ApiProperty({ description: 'Color de fondo de la paleta' })
  color!: string;
}

export class AppSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) shortDescription!: string | null;
  @ApiProperty({ enum: APP_STATUSES }) status!: string;
  @ApiProperty({ enum: ACCESS_LEVELS }) accessLevel!: string;
  @ApiProperty({ type: AppIconDto }) icon!: AppIconDto;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ nullable: true, type: String }) repoUrl!: string | null;
  @ApiProperty({ description: 'Handle de GitHub de quien la creó' }) precursorHandle!: string;
  @ApiProperty({ description: 'Si quien consulta es su precursor' }) isPrecursor!: boolean;
  @ApiProperty({ description: 'Si quien consulta puede editarla' }) canEdit!: boolean;
  @ApiProperty() isArchived!: boolean;

  @ApiProperty({ description: 'Conversaciones abiertas sobre la app (RF-811).' })
  openThreads!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CreateAppDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @Length(0, 160)
  shortDescription?: string;

  @ApiPropertyOptional({
    enum: ACCESS_LEVELS,
    description:
      'Solo lo elige el dueño del workspace. Lo que crea un invitado queda en WORKSPACE_WRITE.',
  })
  @IsOptional()
  @IsIn(ACCESS_LEVELS)
  accessLevel?: AccessLevel;
}

export class UpdateAppDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ maxLength: 160, nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 160)
  shortDescription?: string;

  @ApiPropertyOptional({ enum: APP_STATUSES })
  @IsOptional()
  @IsIn(APP_STATUSES)
  status?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 8 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Enlace al repositorio. Informativo: no sincroniza nada todavía (RF-417).',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  repoUrl?: string;

  @ApiPropertyOptional({ enum: APP_EMOJIS })
  @IsOptional()
  @IsIn(APP_EMOJIS as readonly string[])
  iconEmoji?: string;

  @ApiPropertyOptional({ enum: APP_COLORS })
  @IsOptional()
  @IsIn(APP_COLORS as readonly string[])
  iconColor?: string;
}

export class ChangeAccessLevelDto {
  @ApiProperty({ enum: ACCESS_LEVELS })
  @IsIn(ACCESS_LEVELS)
  accessLevel!: AccessLevel;
}

export class TransferPrecursorDto {
  @ApiProperty({ format: 'uuid', description: 'Miembro del workspace que pasa a ser precursor' })
  @IsUUID()
  userId!: string;
}

export class AppListDto {
  @ApiProperty({ type: [AppSummaryDto] }) items!: AppSummaryDto[];

  @ApiProperty({
    description: 'Cuántas hay en total con estos filtros, no cuántas trae esta página.',
  })
  total!: number;

  @ApiProperty() page!: number;
  @ApiProperty() perPage!: number;

  @ApiProperty({
    type: [String],
    description:
      'Todas las etiquetas usadas en el workspace, para poder ofrecer el filtro sin una consulta aparte.',
  })
  availableTags!: string[];
}

/** Filtros del listado. Todo opcional: sin nada, el listado de siempre (RF-602, RF-603). */
export class ListAppsQueryDto {
  @ApiPropertyOptional({ description: 'Estados separados por comas, p. ej. `IDEA,DEFINING`' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Niveles de acceso separados por comas' })
  @IsOptional()
  @IsString()
  accessLevel?: string;

  @ApiPropertyOptional({ description: 'Etiquetas separadas por comas; se exigen todas' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    enum: ['hide', 'only', 'all'],
    description: 'Las archivadas se ocultan salvo que se pidan.',
  })
  @IsOptional()
  @IsIn(['hide', 'only', 'all'])
  archived?: 'hide' | 'only' | 'all';

  @ApiPropertyOptional({ enum: ['updated', 'name'] })
  @IsOptional()
  @IsIn(['updated', 'name'])
  sort?: 'updated' | 'name';

  @ApiPropertyOptional({ description: 'Desde 1' })
  @IsOptional()
  @IsNumberString()
  page?: string;

  @ApiPropertyOptional({ description: 'Por defecto 24, como mucho 100' })
  @IsOptional()
  @IsNumberString()
  perPage?: string;
}
