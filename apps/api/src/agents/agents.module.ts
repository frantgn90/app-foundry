import { Module } from '@nestjs/common';

import { AgentTemplatesController } from './agent-templates.controller.js';
import { AgentTemplatesService } from './agent-templates.service.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  controllers: [AgentTemplatesController, AgentsController],
  providers: [AgentTemplatesService, AgentsService],
  exports: [AgentTemplatesService, AgentsService],
})
export class AgentsModule {}
