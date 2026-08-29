import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { from, lastValueFrom, type Observable } from 'rxjs';

import type { Database } from '@app-foundry/db';

import { DATABASE } from '../infrastructure/tokens.js';
import { requestContext } from './request-context.js';

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
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id ?? null;

    return from(
      this.db.transaction(async (tx) => {
        if (userId !== null) {
          await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
        }
        // El observable de Nest es `any`; se acota a `unknown` para que el
        // valor de retorno del handler no se cuele sin tipar.
        return requestContext.run({ tx, userId }, (): Promise<unknown> =>
          lastValueFrom<unknown>(next.handle()),
        );
      }),
    );
  }
}
