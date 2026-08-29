import { type ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * Traduce los rechazos de PostgreSQL a respuestas HTTP con sentido.
 *
 * Buena parte de las reglas de este producto viven en el motor —políticas de
 * seguridad, triggers, restricciones— y cuando rechazan algo lo hacen con un
 * SQLSTATE, no con una excepción de Nest. Sin esto, una regla que funciona
 * perfectamente se presenta al usuario como un error interno del servidor.
 *
 * Extiende el filtro base en lugar de sustituirlo. Un filtro que **relanza** la
 * excepción no la devuelve al manejador por defecto: sube hasta Express, que
 * responde con su página de error genérica. El código de estado llega bien pero
 * el cuerpo sale en HTML y vacío, así que un 409 cuidadosamente construido se
 * convierte en algo que el cliente no puede leer.
 */
const SQLSTATE_TO_HTTP: Record<string, HttpStatus> = {
  // Rechazado por una política de RLS o por un trigger de autorización.
  '42501': HttpStatus.FORBIDDEN,
  // Ya existe: un slug repetido, una invitación duplicada.
  '23505': HttpStatus.CONFLICT,
  // Referencia a algo que no existe.
  '23503': HttpStatus.BAD_REQUEST,
  // CHECK violado: por ejemplo, dejar la instancia sin administradores.
  '23514': HttpStatus.CONFLICT,
  // Falta un dato obligatorio.
  '23502': HttpStatus.BAD_REQUEST,
};

interface PostgresError {
  code?: string;
  message?: string;
  cause?: unknown;
}

@Catch()
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(DatabaseExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    // Lo que ya es una excepción HTTP lo resuelve Nest como siempre.
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    // Se busca el error original de Postgres, no el envoltorio de Drizzle: el
    // mensaje de este último incluye la consulta entera con sus columnas, y
    // devolvérselo al cliente filtraría la forma del esquema.
    const original = this.postgresErrorOf(exception);
    const status = original ? SQLSTATE_TO_HTTP[original.code ?? ''] : undefined;

    if (!status || !original) {
      super.catch(exception, host);
      return;
    }

    const message = this.messageOf(original, status);
    this.logger.warn(
      `La base de datos rechazó la operación (SQLSTATE ${original.code ?? '?'}): ${message}`,
    );

    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, message });
  }

  private postgresErrorOf(error: unknown): PostgresError | undefined {
    let current: unknown = error;
    while (current !== null && current !== undefined) {
      const code = (current as PostgresError).code;
      // Los SQLSTATE son cinco caracteres alfanuméricos; los de Node son
      // cadenas como ECONNREFUSED, que no queremos confundir con estos.
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
        return current;
      }
      current = (current as PostgresError).cause;
    }
    return undefined;
  }

  /**
   * Los mensajes de nuestros triggers están escritos para que alguien los lea,
   * así que se aprovechan. Los de las políticas y restricciones internas hablan
   * de tablas y columnas, y se sustituyen por algo genérico.
   */
  private messageOf(error: PostgresError, status: HttpStatus): string {
    const raw = error.message ?? '';
    const isOurs =
      status === HttpStatus.FORBIDDEN &&
      raw.length > 0 &&
      !raw.includes('for table') &&
      !raw.includes('permission denied');

    if (isOurs) return raw;
    if (status === HttpStatus.FORBIDDEN) return 'You are not allowed to do that';
    if (status === HttpStatus.CONFLICT) {
      return 'That conflicts with something that already exists';
    }
    return 'The operation was rejected';
  }
}
