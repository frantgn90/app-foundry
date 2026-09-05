import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CommentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) parentId!: string | null;
  @ApiProperty({ description: 'Vacío si el comentario fue borrado' }) body!: string;

  @ApiProperty({
    enum: ['USER', 'AGENT'],
    description: 'Quién lo escribió. Un agente se distingue sin deducirlo (RF-1611)',
  })
  authorKind!: string;

  @ApiProperty() authorHandle!: string;
  @ApiProperty() authorDisplayName!: string;
  @ApiProperty({ nullable: true, type: String }) authorAvatarUrl!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Solo en agentes' })
  authorIconEmoji!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Solo en agentes' })
  authorIconColor!: string | null;

  @ApiProperty({ description: 'Un agente retirado sigue firmando lo que escribió (RF-1509)' })
  authorRetired!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Con qué se generó, si lo escribió un agente (RF-1704)',
  })
  aiProvider!: string | null;

  @ApiProperty({ nullable: true, type: String }) aiModelId!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Lo que el modelo se dijo antes de contestar. Solo los que piensan en voz alta',
  })
  aiReasoning!: string | null;
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
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Versión a la que pertenece (RF-817). Null en los generales, que son de la app.',
  })
  versionId!: string | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Número de esa versión' })
  versionNo!: number | null;

  @ApiProperty({
    enum: ['ANCHORED', 'ORPHANED'],
    nullable: true,
    type: String,
    description: 'Solo en hilos inline. Huérfano cuando su fragmento ya no existe.',
  })
  anchorStatus!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Fragmento comentado' })
  anchorQuote!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Posición en el texto que se ha pedido: el de la versión, o la copia de trabajo.',
  })
  anchorStart!: number | null;
  @ApiProperty({ nullable: true, type: Number }) anchorEnd!: number | null;

  @ApiProperty({ nullable: true, type: String, description: 'Quién lo resolvió' })
  resolvedByHandle!: string | null;

  @ApiProperty() canDelete!: boolean;
  @ApiProperty({ type: [CommentDto] }) comments!: CommentDto[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

/** Cuántos hilos abiertos quedan en otra versión, y en cuál (RF-817). */
export class OpenElsewhereDto {
  @ApiProperty({ format: 'uuid' }) versionId!: string;
  @ApiProperty() versionNo!: number;
  @ApiProperty() openThreads!: number;
}

export class ThreadsDto {
  @ApiProperty({ type: [ThreadDto], description: 'Los de la versión pedida, más los generales' })
  threads!: ThreadDto[];

  @ApiProperty({
    type: [OpenElsewhereDto],
    description:
      'Conversaciones vivas que quedaron en otras versiones, de la más reciente a la más antigua',
  })
  openElsewhere!: OpenElsewhereDto[];
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

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Versión que se está mirando. Solo se admite comentar sobre la actual (RF-817): ' +
      'sobre una anterior, lo escrito quedaría anclado a un texto que ya nadie ve.',
  })
  @IsOptional()
  @IsUUID()
  versionId?: string;
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
