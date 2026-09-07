import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { ReviewEstimateDto } from './reviews.dto.js';
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
}
