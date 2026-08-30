import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import {
  AdminUserDto,
  AuditEntryDto,
  AuditQueryDto,
  InstanceMetricsDto,
  UpdateUserDto,
} from './admin.dto.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  @ApiOperation({
    summary: 'Cuentas de la instancia',
    description: 'Rol, estado y actividad. En cuántos workspaces está cada uno, no en cuáles.',
  })
  @ApiOkResponse({ type: [AdminUserDto] })
  users(@CurrentUserId() userId: string): Promise<AdminUserDto[]> {
    return this.admin.listUsers(userId);
  }

  @Patch('users/:id')
  @ApiOperation({
    summary: 'Cambiar rol o estado de una cuenta',
    description:
      'La instancia nunca puede quedarse sin administrador activo, y desactivar cierra las sesiones abiertas (RF-202, RF-203).',
  })
  @ApiOkResponse({ type: AdminUserDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUserId() userId: string,
  ): Promise<AdminUserDto> {
    return this.admin.updateUser(id, body, userId);
  }

  @Get('metrics')
  @ApiOperation({
    summary: 'Métricas de la instancia',
    description: 'Números agregados, sin acceder al contenido de ningún workspace (RF-204).',
  })
  @ApiOkResponse({ type: InstanceMetricsDto })
  metrics(@CurrentUserId() userId: string): Promise<InstanceMetricsDto> {
    return this.admin.metrics(userId);
  }

  @Get('audit')
  @ApiOperation({
    summary: 'Auditoría de plataforma',
    description:
      'Altas, sesiones y roles. Lo que ocurre dentro de un workspace es de su dueño (RF-703, RF-704).',
  })
  @ApiOkResponse({ type: [AuditEntryDto] })
  audit(
    @Query() filtros: AuditQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<AuditEntryDto[]> {
    return this.admin.platformAudit(filtros, userId);
  }
}
