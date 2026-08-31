import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, MaxLength, Min } from 'class-validator';

export class WorkingAuthorDto {
  @ApiProperty() handle!: string;
  @ApiProperty() displayName!: string;
}

export class DocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['VISION', 'PRD', 'TRD'] }) type!: string;
  @ApiProperty({ description: 'La copia de trabajo, que puede ir por delante de la versión' })
  content!: string;
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Última versión commiteada. Es a la que pertenecen los comentarios de hoy.',
  })
  currentVersionId!: string | null;
  @ApiProperty() versionNo!: number;
  @ApiProperty({
    description: 'Lo que hay que devolver al guardar, commitear o descartar (RF-511).',
  })
  revision!: number;
  @ApiProperty({ description: 'Si la copia de trabajo va por delante de la versión' })
  uncommittedChanges!: boolean;
  @ApiProperty({
    type: [WorkingAuthorDto],
    description: 'Quién ha guardado desde el último commit (RF-515, RF-516)',
  })
  workingAuthors!: WorkingAuthorDto[];
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SaveDocumentDto {
  @ApiProperty({ description: 'Contenido completo en markdown' })
  @IsString()
  @MaxLength(500_000)
  content!: string;

  @ApiProperty({
    description:
      'Revisión de la copia de trabajo desde la que se editó. Si alguien guardó ' +
      'mientras tanto, la petición se rechaza con 409 en lugar de sobrescribir.',
  })
  @IsInt()
  @Min(0)
  revision!: number;
}

/**
 * Commitear: crear la versión con lo que haya en la copia de trabajo (RF-505).
 *
 * El mensaje es obligatorio y corto a propósito. Una versión sin explicación es
 * una fecha en una lista, y cien caracteres bastan para decir qué cambió sin
 * convertir el historial en el sitio donde se escribe la documentación.
 */
export class CommitDocumentDto {
  @ApiProperty({ maxLength: 100, description: 'Qué cambió y por qué' })
  @IsString()
  @Length(1, 100)
  message!: string;

  @ApiProperty({ description: 'Revisión de la copia de trabajo que se está commiteando' })
  @IsInt()
  @Min(0)
  revision!: number;
}

/** Descartar los cambios sin commitear (RF-515). */
export class ResetDocumentDto {
  @ApiProperty({ description: 'Revisión que se está descartando' })
  @IsInt()
  @Min(0)
  revision!: number;
}

export class VersionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() versionNo!: number;
  @ApiProperty() authorHandle!: string;
  @ApiProperty() authorDisplayName!: string;
  @ApiProperty({
    type: [String],
    description: 'Quienes escribieron en ella sin commitearla (RF-516)',
  })
  coauthorHandles!: string[];
  @ApiProperty({ nullable: true, type: String }) message!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class VersionDetailDto extends VersionSummaryDto {
  @ApiProperty() content!: string;
}

export class DiffDto {
  @ApiProperty({ type: VersionDetailDto }) from!: VersionDetailDto;
  @ApiProperty({ type: VersionDetailDto }) to!: VersionDetailDto;
}

export class ContributorDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() handle!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) avatarUrl!: string | null;
  @ApiProperty({ description: 'Cuántas versiones ha escrito' }) versionCount!: number;
}

export class ConflictDto {
  @ApiProperty({ example: 409 }) statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty({ description: 'Contenido que hay ahora mismo guardado' }) currentContent!: string;
  @ApiProperty({ format: 'uuid' }) currentVersionId!: string;
  @ApiProperty() currentVersionNo!: number;
  @ApiProperty({ description: 'Revisión que hay ahora, para poder reintentar' }) revision!: number;
  @ApiProperty({ description: 'Quién guardó mientras tanto' }) lastAuthorHandle!: string;
}
