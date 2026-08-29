import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { from, lastValueFrom, type Observable } from 'rxjs';

import type { Database } from '@app-foundry/db';

import { DATABASE } from '../infrastructure/tokens.js';
import { requestContext } from './request-context.js';
import { SIN_TRANSACCION } from './sin-transaccion.decorator.js';

/**
 * Abre una transacción por petición y fija en ella la identidad del usuario.
 *
 * Es la pieza que conecta la sesión HTTP con la Row-Level Security. El `true`
 * de `set_config` la hace **local a la transacción**: cuando termina, la
 * identidad desaparece, de modo que una conexión devuelta al pool no puede
 * arrastrar la del usuario anterior. Sin ese detalle, la primera petición
 * concurrente de otra persona vería datos ajenos (TRD §6.2).
 *
 * Los guards se ejecutan antes que los interceptores, así que cuando esto corre
 * la sesión ya está validada y `request.user` disponible.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TransactionInterceptor.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Las rutas de larga duración se quedan fuera: retendrían una conexión del
    // pool mientras dure la conexión del navegador.
    if (this.reflector.get<boolean>(SIN_TRANSACCION, context.getHandler())) {
      return next.handle() as Observable<unknown>;
    }

    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id ?? null;

    const pendientes: (() => Promise<void>)[] = [];

    return from(
      this.db
        .transaction(async (tx) => {
          if (userId !== null) {
            await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
          }
          // El observable de Nest es `any`; se acota a `unknown` para que el
          // valor de retorno del handler no se cuele sin tipar.
          return requestContext.run({ tx, userId, trasCommit: pendientes }, (): Promise<unknown> =>
            lastValueFrom<unknown>(next.handle()),
          );
        })
        .then(async (resultado) => {
          /*
           * Los efectos aplazados corren aquí, con la transacción ya confirmada.
           *
           * Y su fallo no se propaga: son cosas como avisar por el canal en
           * tiempo real, y que el aviso no salga no puede convertir en error una
           * petición que ya se guardó. El aviso sigue en la tabla y aparece en
           * cuanto se recarga.
           */
          for (const efecto of pendientes) {
            try {
              await efecto();
            } catch (error) {
              this.logger.warn(
                { err: error },
                'Un efecto posterior al commit falló; la petición ya está guardada',
              );
            }
          }
          return resultado;
        }),
    );
  }
}
