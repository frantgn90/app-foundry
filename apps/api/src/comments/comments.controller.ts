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
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import {
  CommentDto,
  CreateCommentDto,
  CreateThreadDto,
  MentionableUserDto,
  ThreadDto,
  ThreadsDto,
  UpdateCommentDto,
} from './comments.dto.js';
import { CommentsService } from './comments.service.js';

@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('apps/:appId/threads')
  @ApiOperation({
    summary: 'Hilos de comentarios de una versión',
    description:
      'Un hilo pertenece a la versión sobre la que se escribió. Sin `versionId` ' +
      'se devuelven los de la copia de trabajo, colocados sobre el texto que se ' +
      'está leyendo. Los generales van siempre, sea cual sea la versión. ' +
      'Devuelve todos, incluidos los resueltos: la interfaz decide qué enseña.',
  })
  @ApiQuery({ name: 'versionId', required: false, format: 'uuid' })
  @ApiOkResponse({ type: ThreadsDto })
  list(
    @Param('appId', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
    @Query('versionId', new ParseUUIDPipe({ optional: true })) versionId?: string,
  ): Promise<ThreadsDto> {
    return this.comments.list(appId, userId, versionId);
  }

  @Post('apps/:appId/threads')
  @ApiOperation({
    summary: 'Abrir un hilo',
    description:
      'Con fragmento y posición, el hilo queda anclado al texto; sin ellos, es un hilo general.',
  })
  @ApiOkResponse({ type: ThreadDto })
  createThread(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: CreateThreadDto,
    @CurrentUserId() userId: string,
  ): Promise<ThreadDto> {
    return this.comments.createThread(appId, body, userId);
  }

  @Get('apps/:appId/mentionable')
  @ApiOperation({
    summary: 'A quién se puede mencionar',
    description: 'Solo miembros del workspace: mencionar no revela quién más usa la plataforma.',
  })
  @ApiOkResponse({ type: [MentionableUserDto] })
  mentionable(@Param('appId', ParseUUIDPipe) appId: string): Promise<MentionableUserDto[]> {
    return this.comments.mentionable(appId);
  }

  @Post('threads/:threadId/comments')
  @ApiOperation({ summary: 'Responder en un hilo' })
  @ApiOkResponse({ type: CommentDto })
  reply(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() body: CreateCommentDto,
    @CurrentUserId() userId: string,
  ): Promise<CommentDto> {
    return this.comments.reply(threadId, body, userId);
  }

  @Post('threads/:threadId/resolve')
  @ApiOperation({ summary: 'Dar por resuelto un hilo' })
  @ApiOkResponse({ type: ThreadDto })
  resolve(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUserId() userId: string,
  ): Promise<ThreadDto> {
    return this.comments.setResolved(threadId, true, userId);
  }

  @Post('threads/:threadId/reopen')
  @ApiOperation({ summary: 'Reabrir un hilo resuelto' })
  @ApiOkResponse({ type: ThreadDto })
  reopen(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUserId() userId: string,
  ): Promise<ThreadDto> {
    return this.comments.setResolved(threadId, false, userId);
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Borrar un hilo entero' })
  @ApiNoContentResponse()
  removeThread(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.comments.removeThread(threadId, userId);
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Editar un comentario propio' })
  @ApiOkResponse({ type: CommentDto })
  edit(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() body: UpdateCommentDto,
    @CurrentUserId() userId: string,
  ): Promise<CommentDto> {
    return this.comments.edit(commentId, body.body, userId);
  }

  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Borrar un comentario propio',
    description: 'El hilo conserva su forma: se marca como borrado, no se elimina.',
  })
  @ApiNoContentResponse()
  remove(@Param('commentId', ParseUUIDPipe) commentId: string): Promise<void> {
    return this.comments.remove(commentId);
  }
}
