import { z } from 'zod';

/**
 * Esquema de la configuración de App Foundry.
 *
 * Todo lo que la aplicación necesita saber del entorno se declara aquí y se
 * valida **al arrancar**, no la primera vez que se usa. Un despliegue con una
 * variable mal puesta debe morir en el arranque con un mensaje claro, no
 * fallar media hora después en la petición de un usuario.
 *
 * Los secretos no tienen valor por defecto a propósito (RNF-106): si falta uno,
 * queremos un error, no un arranque silencioso con una clave de ejemplo.
 */
const postgresUrl = z
  .string()
  .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
    message: 'debe ser una URL de PostgreSQL (postgres:// o postgresql://)',
  });

const days = (fallback: number) => z.coerce.number().int().positive().default(fallback);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Origen de la SPA, para CORS y para construir los enlaces de vuelta de OAuth. */
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Dos URLs distintas a propósito: la aplicación se conecta con un rol sin
   * BYPASSRLS y las migraciones con uno privilegiado. Si fueran la misma, la
   * RLS dejaría de ser una garantía (TRD §6.1).
   */
  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl,

  REDIS_URL: z.string().refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
    message: 'debe ser una URL de Redis (redis:// o rediss://)',
  }),

  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  /** Se aplica al darse de alta esa persona (RF-111). */
  BOOTSTRAP_ADMIN_GITHUB_LOGIN: z.string().min(1).optional(),

  /** Clave de firma de las cookies de sesión. 32 caracteres es el mínimo razonable. */
  SESSION_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  SESSION_TTL_DAYS: days(30),
  INVITATION_TTL_DAYS: days(14),

  /** Purga de notificaciones (RF-910). */
  NOTIF_RETENTION_DAYS: days(30),
  NOTIF_MAX_PER_USER: z.coerce.number().int().positive().default(500),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().default('app-foundry-api'),
  /** Permite apagar la telemetría en tests sin tocar el código. */
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;
