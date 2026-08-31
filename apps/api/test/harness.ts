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
import { AuthService } from '../src/auth/auth.service.js';
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
  /**
   * Un servicio de la aplicación ya montada.
   *
   * Para lo que no tiene ruta propia todavía —el paso por el que pasará toda
   * invocación—: se ejercita el servicio de verdad, con sus dependencias reales,
   * en lugar de reconstruirlo a mano y probar otra cosa.
   */
  resolve: <T>(token: string | symbol | (new (...args: never[]) => T)) => T;
  /**
   * Da de alta a alguien por el mismo camino que el login real.
   *
   * `createUser` siembra las filas directamente, que es más rápido y sirve para
   * casi todo. Esto pasa por el servicio de autenticación, y es lo que hace
   * falta cuando lo que se comprueba es justo lo que ocurre al entrar.
   */
  signIn: (handle: string) => Promise<{ id: string }>;
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
  /*
   * La IA de los tests habla con el proveedor de mentira y cifra con un llavero
   * de juguete. Todo lo demás —selección de proveedor, permisos, cifrado,
   * políticas— es el camino real (T-36, RNF-901).
   */
  process.env['AI_USE_FAKE_PROVIDER'] = 'true';
  process.env['AI_CREDENTIAL_KEYS'] = `1:${Buffer.alloc(32, 7).toString('base64')}`;

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

  async function signIn(handle: string): Promise<{ id: string }> {
    const auth = app.get(AuthService);
    // El identificador de GitHub es estable para una misma persona: entrar dos
    // veces con el mismo handle tiene que ser la misma cuenta, no dos.
    const githubId =
      800_000 +
      [...handle].reduce((total, letra) => (total * 31 + letra.charCodeAt(0)) % 99_991, 7);
    const user = await auth.provision({
      githubId,
      handle,
      email: `${handle}@example.com`,
      displayName: handle,
      avatarUrl: null,
    });
    return { id: user.id };
  }

  return {
    redisUrl: redis.getConnectionUrl(),
    resolve: (token) => app.get(token as never),
    signIn,
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
