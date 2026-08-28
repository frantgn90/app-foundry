import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../src/index.js';

/** Entorno mínimo válido: solo lo que no tiene valor por defecto. */
const minimo = {
  DATABASE_URL: 'postgres://app_user:x@localhost:5432/app_foundry',
  DATABASE_MIGRATION_URL: 'postgres://foundry_migrator:x@localhost:5432/app_foundry',
  REDIS_URL: 'redis://localhost:6379',
  GITHUB_CLIENT_ID: 'Iv1.0123456789abcdef',
  GITHUB_CLIENT_SECRET: 'un-secreto-de-github',
  SESSION_SECRET: 'a'.repeat(32),
};

describe('carga de la configuración', () => {
  it('acepta un entorno mínimo y aplica los valores por defecto', () => {
    const env = loadEnv(minimo);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.SESSION_TTL_DAYS).toBe(30);
    expect(env.NOTIF_MAX_PER_USER).toBe(500);
    expect(env.OTEL_ENABLED).toBe(true);
  });

  it('convierte los números que llegan como texto', () => {
    const env = loadEnv({ ...minimo, PORT: '8080', NOTIF_RETENTION_DAYS: '7' });
    expect(env.PORT).toBe(8080);
    expect(env.NOTIF_RETENTION_DAYS).toBe(7);
  });

  it('falla si falta una variable obligatoria, y dice cuál', () => {
    const { DATABASE_URL: _omitida, ...sinBaseDeDatos } = minimo;
    expect(() => loadEnv(sinBaseDeDatos)).toThrow(EnvValidationError);
    expect(() => loadEnv(sinBaseDeDatos)).toThrow(/DATABASE_URL/);
  });

  it('rechaza un secreto de sesión demasiado corto', () => {
    expect(() => loadEnv({ ...minimo, SESSION_SECRET: 'corto' })).toThrow(/al menos 32/);
  });

  it('rechaza una URL de base de datos que no es de PostgreSQL', () => {
    expect(() => loadEnv({ ...minimo, DATABASE_URL: 'mysql://x@localhost/y' })).toThrow(
      /PostgreSQL/,
    );
  });

  it('acumula todos los problemas en un solo error, no solo el primero', () => {
    try {
      loadEnv({ ...minimo, SESSION_SECRET: 'corto', REDIS_URL: 'http://localhost' });
      expect.unreachable('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const rutas = (error as EnvValidationError).issues.map((i) => i.path.join('.'));
      expect(rutas).toContain('SESSION_SECRET');
      expect(rutas).toContain('REDIS_URL');
    }
  });

  it('no permite un puerto fuera de rango', () => {
    expect(() => loadEnv({ ...minimo, PORT: '99999' })).toThrow(EnvValidationError);
  });
});
