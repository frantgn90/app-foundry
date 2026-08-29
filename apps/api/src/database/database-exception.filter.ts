import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Traduce los rechazos de PostgreSQL a respuestas HTTP con sentido.
 *
 * Buena parte de las reglas de este producto viven en el motor —políticas de
 * seguridad, triggers, restricciones— y cuando rechazan algo lo hacen con un
 * SQLSTATE, no con una excepción de Nest. Sin esto, una regla que funciona
 * perfectamente se presenta al usuario como un error interno del servidor.
 *
 * Se traduce por código y no por texto: el mensaje depende del idioma del
 * servidor y de la versión de Postgres.
 */
const SQLSTATE_A_HTTP: Record<string, HttpStatus> = {
  // Rechazado por una política de RLS o por un trigger de autorización.
  '42501': HttpStatus.FORBIDDEN,
  // Ya existe: un slug repetido, una invitación duplicada.
  '23505': HttpStatus.CONFLICT,
  // Referencia a algo que no existe.
  '23503': HttpStatus.BAD_REQUEST,
  // CHECK violado: por ejemplo, dejar la instancia sin administradores.
  '23514': HttpStatus.CONFLICT,
  // Not null: falta un dato obligatorio.
  '23502': HttpStatus.BAD_REQUEST,
};

interface ErrorConCodigo {
  code?: string;
  message?: string;
  cause?: unknown;
}

@Catch()
export class DatabaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Lo que ya es una excepción HTTP no se toca.
    if (exception instanceof HttpException) {
      throw exception;
    }

    // Se busca el error **original** de Postgres, no el envoltorio de Drizzle:
    // el mensaje de este último incluye la consulta entera con sus columnas, y
    // devolvérselo al cliente filtraría la forma del esquema.
    const original = this.postgresErrorOf(exception);
    const status = original ? SQLSTATE_A_HTTP[original.code ?? ''] : undefined;

    if (!status || !original) {
      throw exception;
    }

    const response = host.switchToHttp().getResponse<Response>();
    const message = this.messageOf(original, status);

    this.logger.warn(
      `La base de datos rechazó la operación (SQLSTATE ${original.code ?? '?'}): ${message}`,
    );
    response.status(status).json({ statusCode: status, message });
  }

  private postgresErrorOf(error: unknown): ErrorConCodigo | undefined {
    let actual: unknown = error;
    while (actual !== null && actual !== undefined) {
      const code = (actual as ErrorConCodigo).code;
      // Los SQLSTATE son cinco caracteres alfanuméricos; los de Node son
      // cadenas como ECONNREFUSED, que no queremos confundir con estos.
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
        return actual;
      }
      actual = (actual as ErrorConCodigo).cause;
    }
    return undefined;
  }

  /**
   * Los mensajes de los triggers están escritos para que alguien los lea, así
   * que se aprovechan; los de las restricciones internas, no: hablan de tablas
   * y columnas y filtrarían la forma del esquema.
   */
  private messageOf(error: ErrorConCodigo, status: HttpStatus): string {
    const raw = error.message ?? '';
    // Los mensajes de nuestros triggers están escritos para que alguien los
    // lea. Los de las políticas y restricciones internas hablan de tablas y
    // columnas, así que se sustituyen por algo genérico.
    const esDeNuestrosTriggers =
      status === HttpStatus.FORBIDDEN &&
      raw.length > 0 &&
      !raw.includes('for table') &&
      !raw.includes('permission denied');

    if (esDeNuestrosTriggers) return raw;

    if (status === HttpStatus.FORBIDDEN) return 'You are not allowed to do that';
    if (status === HttpStatus.CONFLICT) {
      return 'That conflicts with something that already exists';
    }
    return 'The operation was rejected';
  }
}
