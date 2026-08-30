import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

import { APP_COLORS, WORKSPACE_BACKGROUNDS, WORKSPACE_EMOJIS } from '@app-foundry/core';

export class WorkspaceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({
    description: 'Rol de quien consulta en este workspace',
    enum: ['OWNER', 'MEMBER'],
  })
  role!: 'OWNER' | 'MEMBER';

  @ApiProperty({ description: 'Si es el workspace personal de su dueño' })
  isPersonal!: boolean;

  @ApiProperty() iconEmoji!: string;
  @ApiProperty() iconColor!: string;
  @ApiProperty({ description: 'Fondo elegido del catálogo' }) background!: string;
}

/** Todo lo que el dueño puede cambiar de su workspace (RF-303). */
export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 80 })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ enum: WORKSPACE_EMOJIS })
  @IsOptional()
  @IsIn(WORKSPACE_EMOJIS as readonly string[])
  iconEmoji?: string;

  @ApiPropertyOptional({ enum: APP_COLORS })
  @IsOptional()
  @IsIn(APP_COLORS as readonly string[])
  iconColor?: string;

  @ApiPropertyOptional({
    enum: WORKSPACE_BACKGROUNDS,
    description: 'Identificador del fondo; el catálogo vive en la interfaz.',
  })
  @IsOptional()
  @IsIn(WORKSPACE_BACKGROUNDS as readonly string[])
  background?: string;
}

export class MemberDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  handle!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true, type: String })
  avatarUrl!: string | null;

  @ApiProperty({ enum: ['OWNER', 'MEMBER'] })
  role!: 'OWNER' | 'MEMBER';
}

export class InviteDto {
  @ApiProperty({ format: 'email', description: 'Email de la persona a invitar' })
  @IsEmail()
  email!: string;
}

export class InvitationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class WorkspaceAuditEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String }) actorHandle!: string | null;

  @ApiProperty({ description: 'Qué se hizo, en forma de identificador estable.' })
  action!: string;

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
