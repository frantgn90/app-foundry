import { Module } from '@nestjs/common';

import { AgentTemplatesController } from './agent-templates.controller.js';
import { AgentTemplatesService } from './agent-templates.service.js';
import { AgentQueueService } from './agent-queue.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  controllers: [AgentTemplatesController, AgentsController],
  providers: [AgentTemplatesService, AgentsService, AgentQueueService],
  exports: [AgentTemplatesService, AgentsService, AgentQueueService],
})
export class AgentsModule {}
