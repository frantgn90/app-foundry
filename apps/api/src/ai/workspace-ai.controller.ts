import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import type { AiTask } from '@app-foundry/core';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import {
  AiEgressConsentDto,
  AiModelDto,
  AiSettingsDto,
  AiTaskAssignmentDto,
  AiUsageDto,
  AssignTaskModelDto,
  SetAiEnabledDto,
} from './ai.dto.js';
import { AiCatalogService } from './catalog.service.js';
import { AiProvidersService } from './providers.service.js';
import { AiTasksService } from './tasks.service.js';
import { AiUsageService } from './usage.service.js';

/**
 * Lo que es del workspace y no de un proveedor concreto.
 */
@ApiTags('ai')
@Controller('workspaces/:id/ai')
export class WorkspaceAiController {
  constructor(
    private readonly providers: AiProvidersService,
    private readonly catalog: AiCatalogService,
    private readonly tasks: AiTasksService,
    private readonly usage: AiUsageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Ajustes de IA del workspace' })
  @ApiOkResponse({ type: AiSettingsDto })
  settings(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AiSettingsDto> {
    return this.providers.settings(workspaceId, userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Apagar o encender toda la IA del workspace, sin borrar nada' })
  @ApiOkResponse({ type: AiSettingsDto })
  setEnabled(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Body() body: SetAiEnabledDto,
    @CurrentUserId() userId: string,
  ): Promise<AiSettingsDto> {
    return this.providers.setEnabled(workspaceId, body.enabled, userId);
  }

  @Get('usage')
  @ApiOperation({
    summary: 'Consumo del mes en tokens. Cada uno ve el suyo; el dueño, todo',
  })
  @ApiOkResponse({ type: AiUsageDto })
  usage_(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AiUsageDto> {
    return this.usage.ofMonth(workspaceId, userId);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Qué modelo atiende cada tipo de tarea' })
  @ApiOkResponse({ type: [AiTaskAssignmentDto] })
  tasks_(@Param('id', ParseUUIDPipe) workspaceId: string): Promise<AiTaskAssignmentDto[]> {
    return this.tasks.list(workspaceId);
  }

  @Put('tasks/:task')
  @ApiOperation({ summary: 'Asignar modelo a un tipo de tarea. Solo el dueño' })
  @ApiOkResponse({ type: [AiTaskAssignmentDto] })
  assign(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('task') task: AiTask,
    @Body() body: AssignTaskModelDto,
    @CurrentUserId() userId: string,
  ): Promise<AiTaskAssignmentDto[]> {
    return this.tasks.assign(workspaceId, task, body, userId);
  }

  @Get('models')
  @ApiOperation({ summary: 'Modelos que ofrecen los proveedores configurados' })
  @ApiOkResponse({ type: [AiModelDto] })
  models(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AiModelDto[]> {
    return this.catalog.models(workspaceId, userId);
  }

  @Get('consent')
  @ApiOperation({ summary: 'Si se aceptó que el contenido salga a un tercero' })
  @ApiOkResponse({ type: AiEgressConsentDto })
  consent(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AiEgressConsentDto> {
    return this.providers.egressConsent(workspaceId, userId);
  }

  @Post('consent')
  /* Idempotente: aceptar dos veces no crea una segunda aceptación. */
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aceptar el envío de contenido a terceros. Idempotente y sin vuelta atrás',
  })
  @ApiOkResponse({ type: AiEgressConsentDto })
  accept(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AiEgressConsentDto> {
    return this.providers.acceptEgress(workspaceId, userId);
  }
}
