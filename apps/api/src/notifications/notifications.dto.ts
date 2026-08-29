import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class NotificationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({
    enum: [
      'WORKSPACE_INVITED',
      'APP_COMMENTED',
      'THREAD_REPLIED',
      'THREAD_RESOLVED',
      'MENTIONED',
      'DOCUMENT_VERSION_SAVED',
      'PRECURSOR_TRANSFERRED',
      'APPS_INHERITED',
    ],
  })
  type!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Lo necesario para pintar el aviso sin más consultas. Es una foto del momento: si el comentario se borra después, el aviso sigue leyéndose.',
  })
  payload!: Record<string, unknown>;

  @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) appId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) threadId!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) readAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];

  @ApiProperty({
    description: 'Sin leer. Es el número del contador, y no depende de cuántas se hayan pedido.',
  })
  unread!: number;
}

export class MarkReadDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Cuáles marcar. Si se omite, se marcan todas las pendientes.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  ids?: string[];
}
