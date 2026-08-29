import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class DocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['VISION', 'PRD', 'TRD'] }) type!: string;
  @ApiProperty() content!: string;
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Versión sobre la que se está editando. Hay que devolverla al guardar.',
  })
  currentVersionId!: string | null;
  @ApiProperty() versionNo!: number;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SaveDocumentDto {
  @ApiProperty({ description: 'Contenido completo en markdown' })
  @IsString()
  @MaxLength(500_000)
  content!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Versión desde la que se editó. Si mientras tanto alguien guardó otra, ' +
      'la petición se rechaza con 409 en lugar de sobrescribir.',
  })
  @IsUUID()
  baseVersionId!: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Qué cambió y por qué' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  message?: string;
}

export class VersionSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() versionNo!: number;
  @ApiProperty() authorHandle!: string;
  @ApiProperty() authorDisplayName!: string;
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
  @ApiProperty({ description: 'Quién guardó mientras tanto' }) lastAuthorHandle!: string;
}
