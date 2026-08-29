import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CommentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) parentId!: string | null;
  @ApiProperty({ description: 'Vacío si el comentario fue borrado' }) body!: string;
  @ApiProperty() authorHandle!: string;
  @ApiProperty() authorDisplayName!: string;
  @ApiProperty({ nullable: true, type: String }) authorAvatarUrl!: string | null;
  @ApiProperty() isMine!: boolean;
  @ApiProperty() isDeleted!: boolean;
  @ApiProperty() isEdited!: boolean;
  @ApiProperty({ type: [String], description: 'Handles mencionados' }) mentions!: string[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ThreadDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['GENERAL', 'INLINE'] }) kind!: string;
  @ApiProperty({ enum: ['OPEN', 'RESOLVED'] }) status!: string;

  @ApiProperty({
    enum: ['ANCHORED', 'ORPHANED'],
    nullable: true,
    type: String,
    description: 'Solo en hilos inline. Huérfano cuando su fragmento ya no existe.',
  })
  anchorStatus!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Fragmento comentado' })
  anchorQuote!: string | null;

  @ApiProperty({ nullable: true, type: Number }) anchorStart!: number | null;
  @ApiProperty({ nullable: true, type: Number }) anchorEnd!: number | null;

  @ApiProperty({ nullable: true, type: String, description: 'Quién lo resolvió' })
  resolvedByHandle!: string | null;

  @ApiProperty() canDelete!: boolean;
  @ApiProperty({ type: [CommentDto] }) comments!: CommentDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreateThreadDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  body!: string;

  @ApiPropertyOptional({
    description: 'Fragmento comentado. Si falta, el hilo es general.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  quote?: string;

  @ApiPropertyOptional({ description: 'Posición inicial del fragmento en el markdown' })
  @IsOptional()
  @IsInt()
  @Min(0)
  start?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  end?: number;
}

export class CreateCommentDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  body!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Comentario al que responde' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @Length(1, 4000)
  body!: string;
}

export class MentionableUserDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() handle!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) avatarUrl!: string | null;
}
