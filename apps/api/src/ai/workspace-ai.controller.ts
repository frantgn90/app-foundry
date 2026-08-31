import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { AiEgressConsentDto } from './ai.dto.js';
import { AiProvidersService } from './providers.service.js';

/**
 * Lo que es del workspace y no de un proveedor concreto.
 */
@ApiTags('ai')
@Controller('workspaces/:id/ai')
export class WorkspaceAiController {
  constructor(private readonly providers: AiProvidersService) {}

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
