import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { IdUsuarioActual } from '../auth/current-user.decorator.js';
import {
  InvitacionDto,
  InvitarDto,
  MiembroDto,
  RenombrarWorkspaceDto,
  WorkspaceDto,
} from './workspaces.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'Workspaces a los que pertenezco' })
  @ApiOkResponse({ type: [WorkspaceDto] })
  listar(@IdUsuarioActual() userId: string): Promise<WorkspaceDto[]> {
    return this.workspaces.listar(userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renombrar un workspace propio' })
  @ApiOkResponse({ type: WorkspaceDto })
  renombrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() cuerpo: RenombrarWorkspaceDto,
    @IdUsuarioActual() userId: string,
  ): Promise<WorkspaceDto> {
    return this.workspaces.renombrar(id, cuerpo.name, userId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Miembros del workspace' })
  @ApiOkResponse({ type: [MiembroDto] })
  miembros(@Param('id', ParseUUIDPipe) id: string): Promise<MiembroDto[]> {
    return this.workspaces.miembros(id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Expulsar a un miembro' })
  @ApiNoContentResponse()
  expulsar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) aQuien: string,
    @IdUsuarioActual() userId: string,
  ): Promise<void> {
    return this.workspaces.expulsar(id, aQuien, userId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Abandonar un workspace ajeno' })
  @ApiNoContentResponse()
  abandonar(
    @Param('id', ParseUUIDPipe) id: string,
    @IdUsuarioActual() userId: string,
  ): Promise<void> {
    return this.workspaces.abandonar(id, userId);
  }

  @Get(':id/invitations')
  @ApiOperation({ summary: 'Invitaciones del workspace' })
  @ApiOkResponse({ type: [InvitacionDto] })
  invitaciones(
    @Param('id', ParseUUIDPipe) id: string,
    @IdUsuarioActual() userId: string,
  ): Promise<InvitacionDto[]> {
    return this.workspaces.invitaciones(id, userId);
  }

  @Post(':id/invitations')
  @ApiOperation({
    summary: 'Invitar por email',
    description:
      'La respuesta es idéntica exista o no una cuenta con ese email: invitar no ' +
      'sirve para averiguar quién usa la plataforma.',
  })
  @ApiOkResponse({ type: InvitacionDto })
  invitar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() cuerpo: InvitarDto,
    @IdUsuarioActual() userId: string,
  ): Promise<InvitacionDto> {
    return this.workspaces.invitar(id, cuerpo.email, userId);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revocar una invitación' })
  @ApiNoContentResponse()
  revocar(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @IdUsuarioActual() userId: string,
  ): Promise<void> {
    return this.workspaces.revocarInvitacion(invitationId, userId);
  }
}
