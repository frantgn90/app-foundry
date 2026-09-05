import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { AgentTemplatesService } from './agent-templates.service.js';
import {
  AdoptAgentTemplateDto,
  AgentTemplateDto,
  CatalogAgentDto,
  CreateAgentTemplateDto,
  UpdateAgentTemplateDto,
} from './agents.dto.js';

@ApiTags('agents')
@Controller('workspaces/:id/agent-templates')
export class AgentTemplatesController {
  constructor(private readonly plantillas: AgentTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'Plantillas de agente del workspace. Las ve cualquier miembro' })
  @ApiOkResponse({ type: [AgentTemplateDto] })
  list(@Param('id', ParseUUIDPipe) workspaceId: string): Promise<AgentTemplateDto[]> {
    return this.plantillas.list(workspaceId);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Catálogo de plantillas de fábrica' })
  @ApiOkResponse({ type: [CatalogAgentDto] })
  catalog(@Param('id', ParseUUIDPipe) workspaceId: string): Promise<CatalogAgentDto[]> {
    return this.plantillas.catalog(workspaceId);
  }

  /*
   * Adoptar es crear una plantilla, así que va bajo el mismo recurso y con la
   * misma regla de acceso: el dueño y nadie más (RF-1502, RF-1514).
   */
  @Post('catalog/:key')
  @ApiOperation({ summary: 'Adoptar un perfil de fábrica: lo copia al workspace. Solo el dueño' })
  @ApiOkResponse({ type: AgentTemplateDto })
  adopt(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('key') key: string,
    @Body() body: AdoptAgentTemplateDto,
    @CurrentUserId() userId: string,
  ): Promise<AgentTemplateDto> {
    return this.plantillas.adopt(workspaceId, key, body, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear una plantilla. Solo el dueño' })
  @ApiOkResponse({ type: AgentTemplateDto })
  create(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateAgentTemplateDto,
    @CurrentUserId() userId: string,
  ): Promise<AgentTemplateDto> {
    return this.plantillas.create(workspaceId, body, userId);
  }

  @Patch(':templateId')
  @ApiOperation({ summary: 'Editar una plantilla, sin tocar sus instancias. Solo el dueño' })
  @ApiOkResponse({ type: AgentTemplateDto })
  update(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() body: UpdateAgentTemplateDto,
    @CurrentUserId() userId: string,
  ): Promise<AgentTemplateDto> {
    return this.plantillas.update(workspaceId, templateId, body, userId);
  }

  @Delete(':templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borrar una plantilla. Sus agentes se quedan donde están' })
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.plantillas.remove(workspaceId, templateId, userId);
  }
}
