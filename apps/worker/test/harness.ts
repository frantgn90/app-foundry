import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import { AGENT_REPLY_QUEUE, type AgentReplyJob } from '@app-foundry/core';
import { createDb, type Database, runMigrations } from '@app-foundry/db';

/**
 * Un Postgres y un Redis de verdad para ejercitar el worker.
 *
 * Tienen que ser de verdad los dos: la mitad de lo que hay que comprobar aquí
 * son cortafuegos que viven en consultas y restricciones —el tope de turnos, un
 * agente retirado, la puerta de escritura— y la otra mitad es el comportamiento
 * de la cola. Ninguna de las dos cosas se puede simular con un doble sin acabar
 * probando el doble.
 */
export interface WorkerHarness {
  db: Database;
  redis: Redis;
  cola: Queue<AgentReplyJob>;
  /** El escenario: una app con un agente, un hilo y quien lo provoca. */
  escenario: Escenario;
  encolar: (trabajo: Partial<AgentReplyJob> & { triggerCommentId: string }) => Promise<void>;
  /** Un comentario de una persona en el hilo, para provocar o para replicar. */
  comentar: (texto: string) => Promise<string>;
  /** Los comentarios que ha escrito el agente en el hilo, del primero al último. */
  loEscritoPorElAgente: () => Promise<string[]>;
  stop: () => Promise<void>;
}

export interface Escenario {
  anaId: string;
  workspaceId: string;
  appId: string;
  threadId: string;
  agentId: string;
  promptRevisionId: string;
}

export async function startWorkerHarness(): Promise<WorkerHarness> {
  const postgres = await new PostgreSqlContainer('postgres:18.6-alpine')
    .withDatabase('app_foundry')
    .withUsername('foundry_migrator')
    .withPassword('test')
    .start();
  const redisContainer = await new RedisContainer('redis:8.8.2-alpine').start();

  const url = postgres.getConnectionUri();
  await runMigrations(url);

  const handle = createDb(url);
  const redis = new Redis(redisContainer.getConnectionUrl(), { maxRetriesPerRequest: null });
  const cola = new Queue<AgentReplyJob>(AGENT_REPLY_QUEUE, { connection: redis });

  const escenario = await sembrar(handle.db);

  return {
    db: handle.db,
    redis,
    cola,
    escenario,
    encolar: async (trabajo) => {
      await cola.add(
        trabajo.trigger ?? 'MENTION',
        {
          agentId: trabajo.agentId ?? escenario.agentId,
          threadId: trabajo.threadId ?? escenario.threadId,
          triggerCommentId: trabajo.triggerCommentId,
          actorUserId: trabajo.actorUserId ?? escenario.anaId,
          trigger: trabajo.trigger ?? 'MENTION',
        },
        /* Las mismas opciones que pone el productor de la API: si no, esto
         * probaría una cola distinta de la que corre en producción. */
        { attempts: 4, backoff: { type: 'custom' } },
      );
    },
    comentar: async (texto) => {
      const [fila] = (
        await handle.db.execute<{ id: string }>(
          sql`INSERT INTO comments (thread_id, body, author_id)
              VALUES (${escenario.threadId}::uuid, ${texto}, ${escenario.anaId}::uuid)
              RETURNING id`,
        )
      ).rows;
      return fila!.id;
    },
    loEscritoPorElAgente: async () => {
      const filas = await handle.db.execute<{ body: string }>(
        sql`SELECT body FROM comments
            WHERE thread_id = ${escenario.threadId}::uuid AND author_agent_id IS NOT NULL
            ORDER BY created_at`,
      );
      return filas.rows.map((f) => f.body);
    },
    stop: async () => {
      await cola.close();
      redis.disconnect();
      await handle.close();
      await postgres.stop();
      await redisContainer.stop();
    },
  };
}

/**
 * El escenario mínimo para que un agente pueda contestar.
 *
 * Se siembra como superusuario, que ignora las políticas, para prepararlo sin
 * que estorben. Lo que se prueba después sí corre con el rol de la aplicación,
 * que es donde importa.
 */
async function sembrar(db: Database): Promise<Escenario> {
  const [ana] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO users (github_id, handle, email, display_name)
          VALUES (7001, 'ana', 'ana@example.com', 'Ana') RETURNING id`,
    )
  ).rows;

  const [ws] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO workspaces (owner_id, name, slug)
          VALUES (${ana!.id}::uuid, 'Ana', 'ana') RETURNING id`,
    )
  ).rows;
  await db.execute(
    sql`INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${ws!.id}::uuid, ${ana!.id}::uuid, 'OWNER')`,
  );

  const [app] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO apps (workspace_id, slug, name, precursor_id, access_level, icon_emoji, icon_color)
          VALUES (${ws!.id}::uuid, 'idea', 'Idea', ${ana!.id}::uuid, 'WORKSPACE_WRITE', '💡', 'amber')
          RETURNING id`,
    )
  ).rows;

  const [doc] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO documents (app_id, type) VALUES (${app!.id}::uuid, 'VISION') RETURNING id`,
    )
  ).rows;

  const [hilo] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO comment_threads (app_id, document_id, kind, created_by)
          VALUES (${app!.id}::uuid, ${doc!.id}::uuid, 'GENERAL', ${ana!.id}::uuid)
          RETURNING id`,
    )
  ).rows;

  const [agente] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO agents (app_id, name, handle, icon_emoji, icon_color, added_by)
          VALUES (${app!.id}::uuid, 'Product Owner', 'po', '🎯', 'amber', ${ana!.id}::uuid)
          RETURNING id`,
    )
  ).rows;

  const [revision] = (
    await db.execute<{ id: string }>(
      sql`INSERT INTO agent_prompt_revisions (agent_id, revision, prompt)
          VALUES (${agente!.id}::uuid, 1, 'Ask what problem this solves.') RETURNING id`,
    )
  ).rows;

  return {
    anaId: ana!.id,
    workspaceId: ws!.id,
    appId: app!.id,
    threadId: hilo!.id,
    agentId: agente!.id,
    promptRevisionId: revision!.id,
  };
}
