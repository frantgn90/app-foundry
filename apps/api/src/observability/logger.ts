import { type LoggerService, LogLevel } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import pino, { type Logger as PinoLogger } from 'pino';

/**
 * Campos que nunca deben aparecer en un log.
 *
 * La lista es explícita y no heurística: RNF-112 exige que tokens, cookies,
 * contenido de documentos y texto de comentarios queden fuera por diseño, y una
 * regla que hay que recordar aplicar acaba olvidándose.
 */
const REDACTED_FIELDS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.tokenHash',
  '*.sessionToken',
  '*.clientSecret',
  '*.accessToken',
  // El contenido de los documentos y comentarios no se registra jamás: la
  // observabilidad dice qué pasó, no qué decía.
  '*.content',
  '*.body',
  '*.currentContent',
  '*.ip',
];

export interface LoggerOptions {
  level: string;
  /** Formato legible para desarrollo; en producción, JSON en una línea. */
  pretty: boolean;
  /** Endpoint OTLP al que enviar los logs, además de a la salida estándar. */
  otlpEndpoint?: string | undefined;
}

/**
 * Los logs salen por dos caminos a la vez: la salida estándar, que es donde los
 * mira quien está desarrollando, y OTLP hacia el colector, que los deja en Loki
 * ya correlacionados con su traza. Enviarlos solo por OTLP dejaría la terminal
 * muda, y solo por stdout obligaría a recogerlos del contenedor.
 */
export function createLogger({ level, pretty, otlpEndpoint }: LoggerOptions): PinoLogger {
  const targets = [
    pretty
      ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
      : { target: 'pino/file', options: { destination: 1 } },
    ...(otlpEndpoint
      ? [
          {
            target: 'pino-opentelemetry-transport',
            options: { loggerName: 'app-foundry-api', logRecordProcessorOptions: [] },
          },
        ]
      : []),
  ];

  return pino({
    level,
    redact: { paths: REDACTED_FIELDS, censor: '[redactado]' },
    /**
     * Correlación con la traza: cada línea lleva el identificador del span
     * activo, que es lo que permite saltar de un log a su traza en Grafana y al
     * revés (TRD §13).
     */
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId } = span.spanContext();
      return { trace_id: traceId, span_id: spanId };
    },
    transport: { targets: targets },
  });
}

/** Adaptador para que Nest escriba por pino en lugar de por consola. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, context?: unknown): void {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: unknown, context?: unknown): void {
    this.logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: unknown): void {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: unknown): void {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: unknown): void {
    this.logger.trace({ context }, String(message));
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // El nivel lo fija LOG_LEVEL en el entorno; Nest no lo cambia en caliente.
  }
}
