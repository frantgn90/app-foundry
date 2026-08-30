import { ApiProperty } from '@nestjs/swagger';

import { AppIconDto } from '../apps/apps.dto.js';

export class SearchHitDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) shortDescription!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() accessLevel!: string;
  @ApiProperty({ type: AppIconDto }) icon!: AppIconDto;
  @ApiProperty() isArchived!: boolean;

  @ApiProperty({
    format: 'uuid',
    description: 'De dónde viene el resultado: la búsqueda cruza workspaces (RF-604).',
  })
  workspaceId!: string;

  @ApiProperty() workspaceName!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Trozo del texto donde aparece lo buscado, con las coincidencias marcadas.',
  })
  excerpt!: string | null;
}

export class SearchResultsDto {
  @ApiProperty({ type: [SearchHitDto] }) items!: SearchHitDto[];
  @ApiProperty({ description: 'Lo que se buscó, ya normalizado' }) query!: string;
}
