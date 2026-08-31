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
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { AiEgressConsentDto, AiSettingsDto, SetAiEnabledDto } from './ai.dto.js';
import { AiProvidersService } from './providers.service.js';

/**
 * Lo que es del workspace y no de un proveedor concreto.
 */
@ApiTags('ai')
@Controller('workspaces/:id/ai')
export class WorkspaceAiController {
  constructor(private readonly providers: AiProvidersService) {}

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
