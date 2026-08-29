import { ApiProperty } from '@nestjs/swagger';

export class CurrentUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Nombre de usuario de GitHub, usado en las menciones' })
  handle!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true, type: String })
  avatarUrl!: string | null;

  @ApiProperty({ enum: ['ADMIN', 'MEMBER'] })
  platformRole!: 'ADMIN' | 'MEMBER';
}
