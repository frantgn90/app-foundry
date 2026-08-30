import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class AdminUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() handle!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) avatarUrl!: string | null;
  @ApiProperty({ enum: ['ADMIN', 'MEMBER'] }) platformRole!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DEACTIVATED'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) lastLoginAt!: string | null;

  @ApiProperty({ description: 'En cuántos workspaces está, sin decir cuáles (D-6).' })
  workspaceCount!: number;

  @ApiProperty({ description: 'Si es la propia cuenta de quien consulta.' })
  isMe!: boolean;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ['ADMIN', 'MEMBER'] })
  @IsOptional()
  @IsIn(['ADMIN', 'MEMBER'])
  platformRole?: 'ADMIN' | 'MEMBER';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DEACTIVATED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DEACTIVATED'])
  status?: 'ACTIVE' | 'DEACTIVATED';
}

export class InstanceMetricsDto {
  @ApiProperty() usersTotal!: number;
  @ApiProperty() usersActive!: number;
  @ApiProperty() workspacesTotal!: number;
  @ApiProperty() appsTotal!: number;
  @ApiProperty() appsArchived!: number;
  @ApiProperty() versionsTotal!: number;
  @ApiProperty() threadsOpen!: number;
}

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) actorId!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorHandle!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty({ nullable: true, type: String }) resourceType!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) resourceId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Identificadores y valores de enum. Nunca contenido (RF-706).',
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AuditQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Quién lo hizo' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Desde, en ISO 8601' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Hasta, en ISO 8601' })
  @IsOptional()
  to?: string;
}
