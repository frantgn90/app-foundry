import { Body, Controller, HttpException, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { SinTransaccion } from '../database/sin-transaccion.decorator.js';
import { AssistDto, AssistEstimateDto } from './ai.dto.js';
import { AiAssistService, type AssistEvent } from './assist.service.js';

@ApiTags('ai')
@Controller('apps/:appId/document')
export class AiAssistController {
  constructor(private readonly assist: AiAssistService) {}

  @Post('assist/estimate')
  @ApiOperation({
    summary: 'Techo de tokens de una acción del asistente',
    description:
      'Lo que costaría como mucho, sin invocar a nadie. Se cuenta de verdad contra el ' +
      'proveedor y se comprueba que cabe, así que lo que aquí se rechaza también se ' +
      'habría rechazado al pedirlo.',
  })
  @ApiOkResponse({ type: AssistEstimateDto })
  estimate(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: AssistDto,
    @CurrentUserId() userId: string,
  ): Promise<AssistEstimateDto> {
    return this.assist.estimate(appId, body, userId);
  }

  /**
   * Propuesta de reescritura, en streaming (RF-1401, RF-1407, TRD §11.1).
   *
   * Va **sin la transacción de la petición**: dura lo que tarde el modelo, y
   * retener una conexión del pool todo ese rato agotaría el pool con unas pocas
   * peticiones a la vez. Lo que necesita base de datos abre su propia
   * transacción corta con identidad.
   *
   * Y muere con la petición: si quien lo pidió cierra la pestaña o pulsa
   * descartar, el `AbortController` corta la llamada al proveedor y la
   * invocación se liquida como cancelada con lo que se consumió hasta ahí
   * (RF-1407).
   */
  @Post('assist')
  @SinTransaccion()
  @ApiExcludeEndpoint()
  async stream(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() body: AssistDto,
    @CurrentUserId() userId: string,
    @Res() response: Response,
  ): Promise<void> {
    /*
     * Se escucha el cierre de la **respuesta**, no el de la petición.
     *
     * Parece lo mismo y no lo es: la petición es un POST con su cuerpo ya
     * recibido, así que Node la da por terminada mucho antes y no vuelve a
     * avisar de nada. El que se entera de que el otro lado se ha ido a mitad de
     * la respuesta es este. Escuchando el otro, cancelar no cancelaba nada y la
     * generación seguía hasta el final gastando cuota para nadie.
     *
     * `writableEnded` distingue las dos formas de cerrarse: la normal, cuando
     * ya hemos terminado de escribir, y la que importa, cuando se ha ido antes.
     */
    const abort = new AbortController();
    const cortar = (): void => {
      if (!response.writableEnded) abort.abort();
    };
    response.on('close', cortar);
    response.on('error', cortar);

    const flujo = this.assist.assist(appId, body, userId, abort.signal);

    /*
     * La primera parte del flujo se espera **antes** de abrir el streaming: los
     * rechazos —sin permiso, revisión pasada, no cabe, cupo agotado— ocurren
     * ahí, y mientras no se hayan enviado cabeceras todavía se pueden contestar
     * con su código de estado. Después ya no: a media respuesta no queda código
     * que dar, y por eso el error de proveedor viaja como evento.
     */
    let primero;
    try {
      primero = await flujo.next();
    } catch (error) {
      /*
       * El cuerpo del rechazo se reenvía **entero**, no solo su mensaje: hay
       * rechazos que llevan datos —cuántos tokens sobran, qué modelo— y es con
       * ellos con lo que la interfaz redacta su propia frase en inglés. Quedarse
       * con el texto dejaría al cliente eligiendo entre repetir el español del
       * servidor o perder el número.
       */
      if (error instanceof HttpException) {
        const cuerpo = error.getResponse();
        const detalle =
          typeof cuerpo === 'string' ? { statusCode: error.getStatus(), message: cuerpo } : cuerpo;

        /* Lo que el cliente necesita para no reintentar a ciegas, donde se busca. */
        const espera = (detalle as { retryAfterSeconds?: number }).retryAfterSeconds;
        if (typeof espera === 'number') response.setHeader('Retry-After', String(espera));

        response.status(error.getStatus()).json(detalle);
        return;
      }
      response.status(500).json({ statusCode: 500, message: 'Assist failed' });
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desactiva el buffer de nginx, que si no retiene los trozos hasta juntar
      // un bloque y convierte el streaming en ráfagas.
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
        message: error instanceof Error ? error.message : 'Assist failed',
      });
    } finally {
      response.end();
    }
  }
}

function enviar(response: Response, evento: AssistEvent): void {
  response.write(`event: ${evento.type}\n`);
  response.write(`data: ${JSON.stringify(evento)}\n\n`);
}
