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
import {
  AppSummaryDto,
  ChangeAccessLevelDto,
  CreateAppDto,
  TransferPrecursorDto,
  UpdateAppDto,
} from './apps.dto.js';
import { AppsService } from './apps.service.js';

@ApiTags('apps')
@Controller()
export class AppsController {
  constructor(private readonly apps: AppsService) {}

  @Post('workspaces/:workspaceId/apps')
  @ApiOperation({
    summary: 'Crear una app',
    description:
      'Nace con su documento de visión listo. Lo que crea un invitado en un ' +
      'workspace ajeno queda en WORKSPACE_WRITE.',
  })
  @ApiOkResponse({ type: AppSummaryDto })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: CreateAppDto,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.create(workspaceId, body, userId);
  }

  @Get('workspaces/:workspaceId/apps')
  @ApiOperation({ summary: 'Apps visibles del workspace' })
  @ApiOkResponse({ type: [AppSummaryDto] })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto[]> {
    return this.apps.list(workspaceId, userId);
  }

  @Get('apps/:id')
  @ApiOperation({ summary: 'Ficha de una app' })
  @ApiOkResponse({ type: AppSummaryDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.get(id, userId);
  }

  @Patch('apps/:id')
  @ApiOperation({ summary: 'Editar metadatos' })
  @ApiOkResponse({ type: AppSummaryDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAppDto,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.update(id, body, userId);
  }

  @Patch('apps/:id/access-level')
  @ApiOperation({ summary: 'Cambiar el nivel de acceso' })
  @ApiOkResponse({ type: AppSummaryDto })
  changeAccessLevel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeAccessLevelDto,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.changeAccessLevel(id, body.accessLevel, userId);
  }

  @Post('apps/:id/archive')
  @ApiOperation({ summary: 'Archivar' })
  @ApiOkResponse({ type: AppSummaryDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.setArchived(id, true, userId);
  }

  @Post('apps/:id/unarchive')
  @ApiOperation({ summary: 'Desarchivar' })
  @ApiOkResponse({ type: AppSummaryDto })
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.setArchived(id, false, userId);
  }

  @Post('apps/:id/transfer-precursor')
  @ApiOperation({ summary: 'Transferir el rol de precursor' })
  @ApiOkResponse({ type: AppSummaryDto })
  transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransferPrecursorDto,
    @CurrentUserId() userId: string,
  ): Promise<AppSummaryDto> {
    return this.apps.transferPrecursor(id, body.userId, userId);
  }

  @Delete('apps/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar la app y todo su historial' })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUserId() userId: string): Promise<void> {
    return this.apps.remove(id, userId);
  }
}
