import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { SearchResultsDto } from './search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar apps',
    description:
      'Por nombre, descripción, etiquetas y contenido de la visión, en todos los workspaces del usuario. Cada resultado dice de cuál viene (RF-604).',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Qué buscar' })
  @ApiOkResponse({ type: SearchResultsDto })
  buscar(@Query('q') q?: string): Promise<SearchResultsDto> {
    return this.search.search(q ?? '');
  }
}
