import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module.js';
import { ReviewQueueService } from './review-queue.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/**
 * La revisión en abanico (RF-1606..1610).
 *
 * Importa `AiModule` por el paso común de invocación, que es de donde salen el
 * techo de tokens y el cupo: no hay forma de estimar sin resolver la tarea, la
 * credencial y el modelo, y eso vive ahí.
 */
@Module({
  imports: [AiModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewQueueService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
