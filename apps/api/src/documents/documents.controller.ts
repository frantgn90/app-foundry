import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import {
  CommitDocumentDto,
  ConflictDto,
  ContributorDto,
  DiffDto,
  DocumentDto,
  ResetDocumentDto,
  SaveDocumentDto,
  VersionDetailDto,
  VersionSummaryDto,
} from './documents.dto.js';
import { DocumentsService } from './documents.service.js';

@ApiTags('documents')
@Controller('apps/:appId/document')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'Documento de visión actual' })
  @ApiOkResponse({ type: DocumentDto })
  get(
    @Param('appId', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<DocumentDto> {
    return this.documents.get(appId, userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Guardar en la copia de trabajo',
    description:
      'Guardar no crea versión: escribe en la copia de trabajo, que comparten ' +
      'quienes pueden editar. Hay que enviar la revisión desde la que se editó; ' +
      'si alguien guardó mientras tanto, se responde 409 con lo que hay ahora.',
  })
  @ApiOkResponse({ type: DocumentDto })
  @ApiConflictResponse({ type: ConflictDto })
  save(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: SaveDocumentDto,
    @CurrentUserId() userId: string,
  ): Promise<DocumentDto> {
    return this.documents.save(appId, body, userId);
  }

  @Post('commit')
  @ApiOperation({
    summary: 'Crear una versión con lo que hay en la copia de trabajo',
    description:
      'El mensaje es obligatorio y cabe en cien caracteres. Sin cambios que ' +
      'commitear se responde 400: una versión idéntica a la anterior no cuenta nada.',
  })
  @ApiOkResponse({ type: DocumentDto })
  @ApiConflictResponse({ type: ConflictDto })
  commit(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: CommitDocumentDto,
    @CurrentUserId() userId: string,
  ): Promise<DocumentDto> {
    return this.documents.commit(appId, body, userId);
  }

  @Post('reset')
  @ApiOperation({
    summary: 'Descartar los cambios sin commitear',
    description: 'Devuelve la copia de trabajo a la versión actual. Lo descartado no se recupera.',
  })
  @ApiOkResponse({ type: DocumentDto })
  @ApiConflictResponse({ type: ConflictDto })
  reset(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: ResetDocumentDto,
    @CurrentUserId() userId: string,
  ): Promise<DocumentDto> {
    return this.documents.reset(appId, body, userId);
  }

  @Get('versions')
  @ApiOperation({ summary: 'Historial de versiones' })
  @ApiOkResponse({ type: [VersionSummaryDto] })
  versions(
    @Param('appId', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<VersionSummaryDto[]> {
    return this.documents.versions(appId, userId);
  }

  @Get('versions/:versionId')
  @ApiOperation({ summary: 'Una versión concreta, con su contenido' })
  @ApiOkResponse({ type: VersionDetailDto })
  version(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<VersionDetailDto> {
    return this.documents.version(appId, versionId);
  }

  @Get('diff')
  @ApiOperation({
    summary: 'Dos versiones para comparar',
    description: 'Devuelve ambos contenidos; el cálculo visual de diferencias es cosa del cliente.',
  })
  @ApiQuery({ name: 'from', format: 'uuid' })
  @ApiQuery({ name: 'to', format: 'uuid' })
  @ApiOkResponse({ type: DiffDto })
  diff(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Query('from', ParseUUIDPipe) from: string,
    @Query('to', ParseUUIDPipe) to: string,
  ): Promise<DiffDto> {
    return this.documents.diff(appId, from, to);
  }

  @Post('restore/:versionId')
  @ApiOperation({
    summary: 'Restaurar una versión anterior',
    description:
      'Deja ese contenido en la copia de trabajo, sin crear versión: se puede ' +
      'revisar, seguir editando y commitear con su mensaje. No borra nada.',
  })
  @ApiOkResponse({ type: DocumentDto })
  restore(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUserId() userId: string,
  ): Promise<DocumentDto> {
    return this.documents.restore(appId, versionId, userId);
  }

  @Get('contributors')
  @ApiOperation({ summary: 'Quiénes han escrito en esta visión' })
  @ApiOkResponse({ type: [ContributorDto] })
  contributors(
    @Param('appId', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
  ): Promise<ContributorDto[]> {
    return this.documents.contributors(appId, userId);
  }

  @Get('export')
  @ApiOperation({ summary: 'Descargar como VISION.md' })
  @ApiProduces('text/markdown')
  async export(
    @Param('appId', ParseUUIDPipe) appId: string,
    @CurrentUserId() userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const { filename, body } = await this.documents.exportMarkdown(appId, userId);
    response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return body;
  }
}
