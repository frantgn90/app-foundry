import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

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
}

export class RenameWorkspaceDto {
  @ApiProperty({ minLength: 1, maxLength: 80 })
  @IsString()
  @Length(1, 80)
  name!: string;
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
