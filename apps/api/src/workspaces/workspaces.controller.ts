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

import { CurrentUserId } from '../auth/current-user.decorator.js';
import {
  InvitationDto,
  InviteDto,
  MemberDto,
  UpdateWorkspaceDto,
  WorkspaceDto,
  WorkspaceAuditEntryDto,
} from './workspaces.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'Workspaces a los que pertenezco' })
  @ApiOkResponse({ type: [WorkspaceDto] })
  list(@CurrentUserId() userId: string): Promise<WorkspaceDto[]> {
    return this.workspaces.list(userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cambiar el nombre o el aspecto de un workspace propio' })
  @ApiOkResponse({ type: WorkspaceDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateWorkspaceDto,
    @CurrentUserId() userId: string,
  ): Promise<WorkspaceDto> {
    return this.workspaces.update(id, body, userId);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Miembros del workspace' })
  @ApiOkResponse({ type: [MemberDto] })
  members(@Param('id', ParseUUIDPipe) id: string): Promise<MemberDto[]> {
    return this.workspaces.members(id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Expulsar a un miembro' })
  @ApiNoContentResponse()
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) aQuien: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.workspaces.removeMember(id, aQuien, userId);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Abandonar un workspace ajeno' })
  @ApiNoContentResponse()
  leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUserId() userId: string): Promise<void> {
    return this.workspaces.leave(id, userId);
  }

  @Get(':id/audit')
  @ApiOperation({
    summary: 'Actividad del workspace',
    description:
      'Solo para su dueño. Registra qué pasó, nunca qué decía: ni contenido ni credenciales (RF-704, RF-706).',
  })
  @ApiOkResponse({ type: [WorkspaceAuditEntryDto] })
  audit(@Param('id', ParseUUIDPipe) id: string): Promise<WorkspaceAuditEntryDto[]> {
    return this.workspaces.actividad(id);
  }

  @Get(':id/invitations')
  @ApiOperation({ summary: 'Invitaciones del workspace' })
  @ApiOkResponse({ type: [InvitationDto] })
  invitations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() userId: string,
  ): Promise<InvitationDto[]> {
    return this.workspaces.invitations(id, userId);
  }

  @Post(':id/invitations')
  @ApiOperation({
    summary: 'Invitar por email',
    description:
      'La respuesta es idéntica exista o no una cuenta con ese email: invitar no ' +
      'sirve para averiguar quién usa la plataforma.',
  })
  @ApiOkResponse({ type: InvitationDto })
  invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() cuerpo: InviteDto,
    @CurrentUserId() userId: string,
  ): Promise<InvitationDto> {
    return this.workspaces.invite(id, cuerpo.email, userId);
  }

  @Delete('invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revocar una invitación' })
  @ApiNoContentResponse()
  revoke(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.workspaces.revokeInvitation(invitationId, userId);
  }
}
