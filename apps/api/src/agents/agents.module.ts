import { Module } from '@nestjs/common';

import { AgentTemplatesController } from './agent-templates.controller.js';
import { AgentTemplatesService } from './agent-templates.service.js';

@Module({
  controllers: [AgentTemplatesController],
  providers: [AgentTemplatesService],
  exports: [AgentTemplatesService],
})
export class AgentsModule {}
