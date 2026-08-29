import { createHash, randomBytes } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';

import {
  createDb,
  type Database,
  runMigrations,
  users,
  workspaceMembers,
  workspaces,
} from '@app-foundry/db';

import { AppModule } from '../src/app.module.js';
import { DatabaseExceptionFilter } from '../src/database/database-exception.filter.js';

export interface TestUser {
  id: string;
  handle: string;
  email: string;
  /** Token de sesión en claro, listo para enviarlo como cookie. */
  token: string;
  workspaceId: string;
}

export interface Harness {
  baseUrl: string;
  db: Database;
  /** URL del Redis real, para poder publicar como si fuera otra instancia. */
  redisUrl: string;
  createUser: (handle: string) => Promise<TestUser>;
  as: (user: TestUser) => RequestHelper;
  anonymous: () => RequestHelper;
  stop: () => Promise<void>;
}

interface RequestHelper {
  get: (path: string) => Promise<Response>;
  post: (path: string, body?: unknown) => Promise<Response>;
  put: (path: string, body?: unknown) => Promise<Response>;
  patch: (path: string, body?: unknown) => Promise<Response>;
  delete: (path: string) => Promise<Response>;
}

/**
 * Levanta la aplicación entera contra Postgres y Redis reales.
 *
 * Lo importante es **cómo se conecta**: la aplicación usa el rol `app_user`,
 * igual que en producción, no el rol de migraciones. Si se conectara como
 * superusuario, la Row-Level Security no se aplicaría y todos los tests de
 * permisos pasarían sin probar nada, que es la forma más silenciosa de tener
 * una suite inútil.
 */
export async function startHarness(): Promise<Harness> {
  const postgres = await new PostgreSqlContainer('postgres:18.6-alpine')
    .withDatabase('app_foundry')
    .withUsername('foundry_migrator')
    .withPassword('test')
    .start();
  const redis = await new RedisContainer('redis:8.8.2-alpine').start();

  const migrationUrl = postgres.getConnectionUri();
  await runMigrations(migrationUrl);

  // La migración crea el rol sin contraseña, porque un secreto no se versiona.
  // Aquí se le pone una para poder conectarse con él.
  const admin = createDb(migrationUrl, 1);
  await admin.db.execute(sql`ALTER ROLE app_user WITH PASSWORD 'test'`);
  await admin.close();

  const appUrl = migrationUrl.replace('foundry_migrator:test', 'app_user:test');

  process.env['DATABASE_URL'] = appUrl;
  process.env['DATABASE_MIGRATION_URL'] = migrationUrl;
  process.env['REDIS_URL'] = redis.getConnectionUrl();
  process.env['SESSION_SECRET'] = 'a'.repeat(40);
  process.env['GITHUB_CLIENT_ID'] = 'test';
  process.env['GITHUB_CLIENT_SECRET'] = 'test';
  process.env['OTEL_ENABLED'] = 'false';
  process.env['NODE_ENV'] = 'test';

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.use(cookieParser('a'.repeat(40)));
  app.useGlobalFilters(new DatabaseExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(0);

  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  // Conexión propia para preparar escenarios, con el rol privilegiado: montar
  // el decorado no es lo que se está probando.
  const seeding = createDb(migrationUrl, 2);

  let counter = 0;

  async function createUser(handle: string): Promise<TestUser> {
    counter += 1;
    const email = `${handle}@example.com`;

    const [user] = await seeding.db
      .insert(users)
      .values({ githubId: 900_000 + counter, handle, email, displayName: handle })
      .returning({ id: users.id });

    const [workspace] = await seeding.db
      .insert(workspaces)
      .values({ ownerId: user!.id, name: `${handle}'s workspace`, slug: handle })
      .returning({ id: workspaces.id });

    await seeding.db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace!.id, userId: user!.id, role: 'OWNER' });

    const token = randomBytes(32).toString('base64url');
    await seeding.db.execute(
      sql`SELECT auth_create_session(${user!.id}::uuid,
                                     ${createHash('sha256').update(token).digest()}::bytea,
                                     ${new Date(Date.now() + 86_400_000).toISOString()}::timestamptz,
                                     NULL::inet, 'tests'::text)`,
    );

    return { id: user!.id, handle, email, token, workspaceId: workspace!.id };
  }

  function request(token: string | null): RequestHelper {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Cookie'] = `foundry_session=${token}`;

    const send = (method: string) => async (path: string, body?: unknown) =>
      fetch(`${url}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    return {
      get: (path) => send('GET')(path),
      post: send('POST'),
      put: send('PUT'),
      patch: send('PATCH'),
      delete: (path) => send('DELETE')(path),
    };
  }

  return {
    redisUrl: redis.getConnectionUrl(),
    baseUrl: url,
    db: seeding.db,
    createUser,
    as: (user) => request(user.token),
    anonymous: () => request(null),
    stop: async () => {
      await app.close();
      await seeding.close();
      await postgres.stop();
      await redis.stop();
    },
  };
}
