import { Module } from '@nestjs/common';

import { AppsController } from './apps.controller.js';
import { AppsService } from './apps.service.js';

@Module({
  controllers: [AppsController],
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}
