import { Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { ReviewDto, ReviewEstimateDto } from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('reviews')
@Controller('apps/:id/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /**
   * `POST` y no `GET` aunque no cambie nada: contar los tokens de entrada es
   * una llamada al proveedor por cada agente, y eso no es algo que deba poder
   * dispararse desde una barra de direcciones ni quedarse en una caché.
   */
  @Post('estimate')
  @ApiOperation({
    summary: 'Cuánto costaría como mucho una revisión. Basta con poder leer la app',
    description:
      'Entrada contada de verdad y salida al máximo, por cada agente activo. Si no cabe en el cupo, la revisión no arrancará.',
  })
  @ApiOkResponse({ type: ReviewEstimateDto })
  estimate(
    @Param('id', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<ReviewEstimateDto> {
    return this.reviews.estimate(appId, userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Lanzar la revisión. Basta con poder leer la app',
    description:
      'Vuelve a estimar antes de arrancar: entre ver el número y confirmar pueden haberse gastado el cupo o haberse pausado un agente. Si no cabe, no arranca.',
  })
  @ApiOkResponse({ type: ReviewDto })
  start(
    @Param('id', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<ReviewDto> {
    return this.reviews.start(appId, userId);
  }

  @Get('current')
  @ApiOperation({
    summary: 'La revisión viva, o la última que hubo',
    description: 'Nulo si esta app no se ha revisado nunca.',
  })
  @ApiOkResponse({ type: ReviewDto, nullable: true })
  current(
    @Param('id', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<ReviewDto | null> {
    return this.reviews.current(appId, userId);
  }

  @Delete(':reviewId')
  @ApiOperation({
    summary: 'Pararla a media: quien la pidió o el precursor de la app',
    description: 'Lo ya escrito se queda; lo que no ha empezado no arranca.',
  })
  @ApiOkResponse({ type: ReviewDto })
  cancel(
    @Param('id', ParseUUIDPipe) appId: string,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @CurrentUserId() userId: string,
  ): Promise<ReviewDto> {
    return this.reviews.cancel(appId, reviewId, userId);
  }
}
