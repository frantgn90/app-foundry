import { Body, Controller, HttpException, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { SinTransaccion } from '../database/sin-transaccion.decorator.js';
import { GenerateIdeasDto } from './ai.dto.js';
import { AiIdeasService, type IdeaEvent } from './ideas.service.js';

@ApiTags('ai')
@Controller('workspaces/:workspaceId/ai')
export class AiIdeasController {
  constructor(private readonly ideas: AiIdeasService) {}

  /**
   * Ideas de app, en streaming (RF-1301, RF-1306).
   *
   * Mismo trato que el asistente y por las mismas razones: sin la transacción de
   * la petición, porque dura lo que tarde el modelo; y muere con la conexión,
   * escuchando el cierre de la **respuesta** —el de la petición no llega, porque
   * su cuerpo se recibió entero hace rato—.
   */
  @Post('ideas')
  @SinTransaccion()
  @ApiExcludeEndpoint()
  async stream(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() body: GenerateIdeasDto,
    @CurrentUserId() userId: string,
    @Res() response: Response,
  ): Promise<void> {
    const abort = new AbortController();
    const cortar = (): void => {
      if (!response.writableEnded) abort.abort();
    };
    response.on('close', cortar);
    response.on('error', cortar);

    const { exclude, ...constraints } = body;
    const flujo = this.ideas.generate(
      workspaceId,
      { constraints, ...(exclude !== undefined && { exclude }) },
      userId,
      abort.signal,
    );

    /*
     * El primer paso se espera antes de abrir el streaming: los rechazos —sin
     * modelo asignado, sin cupo, sin ser miembro— ocurren ahí, y mientras no se
     * hayan enviado cabeceras todavía se pueden contestar con su código.
     */
    let primero;
    try {
      primero = await flujo.next();
    } catch (error) {
      if (error instanceof HttpException) {
        const cuerpo = error.getResponse();
        response
          .status(error.getStatus())
          .json(
            typeof cuerpo === 'string'
              ? { statusCode: error.getStatus(), message: cuerpo }
              : cuerpo,
          );
        return;
      }
      response.status(500).json({ statusCode: 500, message: 'Could not generate ideas' });
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    try {
      for (let paso = primero; !paso.done; paso = await flujo.next()) {
        enviar(response, paso.value);
      }
    } catch (error) {
      enviar(response, {
        type: 'error',
        kind: 'TRANSIENT',
        message: error instanceof Error ? error.message : 'Could not generate ideas',
      });
    } finally {
      response.end();
    }
  }
}

function enviar(response: Response, evento: IdeaEvent): void {
  response.write(`event: ${evento.type}\n`);
  response.write(`data: ${JSON.stringify(evento)}\n\n`);
}
