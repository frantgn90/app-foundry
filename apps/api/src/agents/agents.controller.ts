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
  Put,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { AgentsService } from './agents.service.js';
import { AddAgentDto, AgentDto, UpdateAgentDto } from './agents.dto.js';

@ApiTags('agents')
@Controller('apps/:id/agents')
export class AgentsController {
  constructor(private readonly agentes: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Agentes de la app. Los ve quien ve la app' })
  @ApiOkResponse({ type: [AgentDto] })
  list(@Param('id', ParseUUIDPipe) appId: string): Promise<AgentDto[]> {
    return this.agentes.list(appId);
  }

  @Post()
  @ApiOperation({ summary: 'Instanciar una plantilla aquí. Quien pueda editar la app' })
  @ApiOkResponse({ type: AgentDto })
  add(
    @Param('id', ParseUUIDPipe) appId: string,
    @Body() body: AddAgentDto,
    @CurrentUserId() userId: string,
  ): Promise<AgentDto> {
    return this.agentes.add(appId, body, userId);
  }

  @Patch(':agentId')
  @ApiOperation({ summary: 'Ajustarlo para esta app, sin tocar la plantilla' })
  @ApiOkResponse({ type: AgentDto })
  update(
    @Param('id', ParseUUIDPipe) appId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() body: UpdateAgentDto,
    @CurrentUserId() userId: string,
  ): Promise<AgentDto> {
    return this.agentes.update(appId, agentId, body, userId);
  }

  /*
   * Adoptar el cambio de la plantilla es una acción y no un campo: trae el
   * prompt de la plantilla como revisión nueva, y como cualquier otro ajuste
   * deja legible el de antes (RF-1505).
   */
  @Post(':agentId/adopt-template')
  @ApiOperation({ summary: 'Traer el prompt actual de su plantilla como revisión nueva' })
  @ApiOkResponse({ type: AgentDto })
  adoptTemplate(
    @Param('id', ParseUUIDPipe) appId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentUserId() userId: string,
  ): Promise<AgentDto> {
    return this.agentes.adoptTemplate(appId, agentId, userId);
  }

  /*
   * Silenciar es de quien lo pide y de nadie más, así que va sin cuerpo: no hay
   * nada que decidir salvo si se calla o se vuelve a oír, y eso lo dice el
   * verbo. Un PATCH con `{ muted: true }` invitaría a preguntarse de quién es
   * ese `muted`.
   */
  @Put(':agentId/mute')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Dejar de recibir avisos de este agente. Solo para quien lo pide' })
  @ApiNoContentResponse()
  mute(
    @Param('id', ParseUUIDPipe) appId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.agentes.silenciar(appId, agentId, userId, true);
  }

  @Delete(':agentId/mute')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Volver a recibir avisos de este agente' })
  @ApiNoContentResponse()
  unmute(
    @Param('id', ParseUUIDPipe) appId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.agentes.silenciar(appId, agentId, userId, false);
  }

  @Get('muted')
  @ApiOperation({ summary: 'A qué agentes de esta app ha silenciado quien pregunta' })
  @ApiOkResponse({ type: [String] })
  muted(
    @Param('id', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<string[]> {
    return this.agentes.silenciados(appId, userId);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirarlo de la app. Lo que escribió se queda' })
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) appId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.agentes.remove(appId, agentId, userId);
  }
}
