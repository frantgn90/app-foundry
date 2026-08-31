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

import type { AiProvider } from '@app-foundry/core';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { AiProviderDto, ConfigureProviderDto, SetProviderStatusDto } from './ai.dto.js';
import { AiProvidersService } from './providers.service.js';

@ApiTags('ai')
@Controller('workspaces/:id/ai/providers')
export class AiProvidersController {
  constructor(private readonly providers: AiProvidersService) {}

  @Get()
  @ApiOperation({ summary: 'Proveedores de IA configurados en el workspace' })
  @ApiOkResponse({ type: [AiProviderDto] })
  list(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @CurrentUserId() userId: string,
  ): Promise<AiProviderDto[]> {
    return this.providers.list(workspaceId, userId);
  }

  @Put(':provider')
  @ApiOperation({ summary: 'Configurar la credencial de un proveedor. Solo el dueño' })
  @ApiOkResponse({ type: AiProviderDto })
  configure(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('provider') provider: AiProvider,
    @Body() body: ConfigureProviderDto,
    @CurrentUserId() userId: string,
  ): Promise<AiProviderDto> {
    return this.providers.configure(workspaceId, provider, body, userId);
  }

  @Post(':provider/verify')
  @ApiOperation({ summary: 'Volver a comprobar la credencial guardada' })
  @ApiOkResponse({ type: AiProviderDto })
  verify(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('provider') provider: AiProvider,
    @CurrentUserId() userId: string,
  ): Promise<AiProviderDto> {
    return this.providers.verify(workspaceId, provider, userId);
  }

  @Patch(':provider')
  @ApiOperation({ summary: 'Apagar o encender un proveedor sin borrarlo' })
  @ApiOkResponse({ type: AiProviderDto })
  setStatus(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('provider') provider: AiProvider,
    @Body() body: SetProviderStatusDto,
    @CurrentUserId() userId: string,
  ): Promise<AiProviderDto> {
    return this.providers.setStatus(workspaceId, provider, body.status, userId);
  }

  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borrar la configuración de un proveedor y su credencial' })
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('provider') provider: AiProvider,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.providers.remove(workspaceId, provider, userId);
  }
}
