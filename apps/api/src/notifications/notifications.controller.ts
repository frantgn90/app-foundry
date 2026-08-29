import { Body, Controller, Delete, Get, Headers, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { SinTransaccion } from '../database/sin-transaccion.decorator.js';
import { MarkReadDto, NotificationListDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Avisos del usuario',
    description:
      'Los más recientes primero. El contador de pendientes viene aparte, porque no depende de cuántos se hayan pedido.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  list(
    @CurrentUserId() userId: string,
    @Query('limit') limit?: string,
  ): Promise<NotificationListDto> {
    return this.notifications.list(userId, limit === undefined ? undefined : Number(limit));
  }

  @Post('read')
  @ApiOperation({
    summary: 'Marcar como leídos',
    description: 'Sin cuerpo, marca todos los pendientes (RF-903).',
  })
  @ApiOkResponse({ type: NotificationListDto })
  markRead(
    @Body() body: MarkReadDto,
    @CurrentUserId() userId: string,
  ): Promise<NotificationListDto> {
    return this.notifications.markRead(userId, body.ids);
  }

  /**
   * Canal de avisos en tiempo real (RF-901).
   *
   * Se escribe a mano sobre la respuesta en lugar de usar el `@Sse` de Nest
   * porque hacen falta tres cosas que ahí no se controlan: el identificador de
   * cada evento, para que el navegador reanude por donde iba; los latidos, para
   * que ningún intermediario dé la conexión por muerta; y reenviar lo perdido al
   * reconectar.
   *
   * Va sin la transacción de la petición: duraría lo que dure la pestaña.
   */
  @Get('stream')
  @SinTransaccion()
  @ApiExcludeEndpoint()
  async stream(
    @CurrentUserId() userId: string,
    @Req() request: Request,
    @Res() response: Response,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    await this.notifications.abrirCanal(userId, request, response, lastEventId);
  }

  @Delete()
  @ApiOperation({
    summary: 'Purgar',
    description:
      'Sin identificadores, vacía todos los leídos. Borrar un aviso no toca el comentario ni la versión a la que apuntaba (RF-909, RF-911).',
  })
  @ApiOkResponse({ type: NotificationListDto })
  purge(@Body() body: MarkReadDto, @CurrentUserId() userId: string): Promise<NotificationListDto> {
    return this.notifications.purge(userId, body.ids);
  }
}
