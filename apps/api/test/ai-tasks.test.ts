import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Qué modelo atiende cada tarea.
 *
 * Es donde el dueño decide en qué gasta su cuota, así que lo que se comprueba es
 * quién decide, qué se puede asignar y qué pasa cuando lo asignado deja de valer.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let modeloValido: string;

interface TaskBody {
  task: string;
  provider: string | null;
  modelId: string | null;
  supported: boolean;
  modelAvailable: boolean;
  missing: string[];
  degraded: string[];
}

const tareas = (quien: TestUser) =>
  h.as(quien).get(`/api/v1/workspaces/${ana.workspaceId}/ai/tasks`);

const asignar = (quien: TestUser, task: string, body: unknown) =>
  h.as(quien).put(`/api/v1/workspaces/${ana.workspaceId}/ai/tasks/${task}`, body);

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });
  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
  await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
    apiKey: 'sk-de-mentira-pero-larga',
  });

  const modelos = (await (
    await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/models`)
  ).json()) as { id: string }[];
  modeloValido = modelos[0]!.id;
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('las cuatro tareas', () => {
  it('salen las cuatro, y configurar un proveedor las deja asignadas', async () => {
    const body = (await (await tareas(ana)).json()) as TaskBody[];

    expect(body).toHaveLength(4);
    /*
     * RF-1103: sin propuesta por defecto, configurar un proveedor dejaría la IA
     * encendida y sin nada asignado, que es como no haberla configurado.
     */
    expect(body.every((t) => t.provider === 'ANTHROPIC' && t.supported)).toBe(true);
    expect(body.map((t) => t.task).sort()).toEqual([
      'AGENT_REPLY',
      'AGENT_REVIEW',
      'IDEA_GENERATION',
      'TEXT_ASSIST',
    ]);
  });

  /*
   * La heurística: sin medida de capacidad que ningún proveedor publique, se usa
   * la ventana de contexto. El pequeño para escribir, donde manda la latencia; el
   * grande para lo que exige razonar.
   */
  it('el asistente de escritura estrena el modelo más pequeño', async () => {
    const modelos = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/models`)
    ).json()) as { id: string; contextWindow: number }[];
    const ordenados = [...modelos].sort((a, b) => a.contextWindow - b.contextWindow);

    const body = (await (await tareas(ana)).json()) as TaskBody[];

    expect(body.find((t) => t.task === 'TEXT_ASSIST')?.modelId).toBe(ordenados[0]?.id);
    expect(body.find((t) => t.task === 'AGENT_REVIEW')?.modelId).toBe(ordenados.at(-1)?.id);
  });

  it('las ve un miembro, porque le dicen qué funciones existen', async () => {
    expect((await tareas(bruno)).status).toBe(200);
  });
});

describe('asignar', () => {
  it('el dueño cambia la propuesta por lo que él quiera', async () => {
    const response = await asignar(ana, 'TEXT_ASSIST', {
      provider: 'ANTHROPIC',
      modelId: modeloValido,
    });
    const body = (await response.json()) as TaskBody[];
    const asignada = body.find((t) => t.task === 'TEXT_ASSIST');

    expect(response.status).toBe(200);
    expect(asignada).toMatchObject({
      provider: 'ANTHROPIC',
      modelId: modeloValido,
      supported: true,
    });
  });

  it('un miembro no asigna nada', async () => {
    const response = await asignar(bruno, 'AGENT_REPLY', {
      provider: 'ANTHROPIC',
      modelId: modeloValido,
    });

    expect(response.status).toBe(403);
  });

  /*
   * Las tres comprobaciones que evitan convertir un error de configuración en
   * un fallo en tiempo de uso, cuando ya nadie lo relaciona con esta pantalla.
   */
  it('no se asigna un proveedor que no está configurado aquí', async () => {
    const response = await asignar(ana, 'TEXT_ASSIST', {
      provider: 'GROQ',
      modelId: modeloValido,
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/configurado/i);
  });

  it('no se asigna un modelo que no está en el catálogo', async () => {
    const response = await asignar(ana, 'TEXT_ASSIST', {
      provider: 'ANTHROPIC',
      modelId: 'modelo-inventado',
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/catálogo/i);
  });

  it('reasignar sustituye, no acumula', async () => {
    const modelos = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/models`)
    ).json()) as { id: string }[];
    const otro = modelos[1]!.id;

    const body = (await (
      await asignar(ana, 'TEXT_ASSIST', { provider: 'ANTHROPIC', modelId: otro })
    ).json()) as TaskBody[];

    expect(body.filter((t) => t.task === 'TEXT_ASSIST')).toHaveLength(1);
    expect(body.find((t) => t.task === 'TEXT_ASSIST')?.modelId).toBe(otro);
  });
});

describe('qué se puede ofrecer ahora mismo', () => {
  interface Availability {
    enabled: boolean;
    tasks: { task: string; available: boolean }[];
  }

  const disponibilidad = (quien: TestUser) =>
    h.as(quien).get(`/api/v1/workspaces/${ana.workspaceId}/ai/availability`);

  /*
   * La consulta un miembro, no el dueño: es quien va a ver —o no— el botón, y
   * saber si merece la pena enseñarlo no puede exigir permisos de configuración
   * (RF-1010).
   */
  it('la puede consultar cualquier miembro', async () => {
    const response = await disponibilidad(bruno);
    const body = (await response.json()) as Availability;

    expect(response.status).toBe(200);
    expect(body.tasks).toHaveLength(4);
    expect(body.tasks.every((t) => t.available)).toBe(true);
  });

  /*
   * Con la IA apagada no se ofrece nada, aunque las asignaciones sigan intactas.
   * Sin esto, un miembro vería botones que el servidor rechaza (RF-1012).
   */
  it('con la IA apagada, nada está disponible', async () => {
    await h.as(ana).patch(`/api/v1/workspaces/${ana.workspaceId}/ai`, { enabled: false });

    const body = (await (await disponibilidad(bruno)).json()) as Availability;

    expect(body.enabled).toBe(false);
    expect(body.tasks.some((t) => t.available)).toBe(false);

    await h.as(ana).patch(`/api/v1/workspaces/${ana.workspaceId}/ai`, { enabled: true });
  });

  it('con el proveedor apagado, tampoco', async () => {
    await h.as(ana).patch(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
      status: 'DISABLED',
    });

    const body = (await (await disponibilidad(bruno)).json()) as Availability;

    /* La IA sigue encendida: lo que falla es el proveedor, y son cosas distintas. */
    expect(body.enabled).toBe(true);
    expect(body.tasks.some((t) => t.available)).toBe(false);

    await h
      .as(ana)
      .patch(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, { status: 'ACTIVE' });
  });
});

describe('cuando un modelo se retira', () => {
  /*
   * El proveedor retira modelos cuando quiere. Lo que no puede pasar es que nos
   * enteremos la próxima vez que alguien use la función, cuando ya nadie
   * relaciona el fallo con un modelo desaparecido hace semanas (RF-1009).
   */
  it('la tarea deja de poder ofrecerse, y se dice que es por el modelo', async () => {
    const body = (await (await tareas(ana)).json()) as TaskBody[];
    const antes = body.find((t) => t.task === 'AGENT_REVIEW');
    expect(antes?.supported).toBe(true);

    await h.db.execute(
      sql`UPDATE ai_models SET available = false WHERE model_id = ${antes!.modelId!}`,
    );

    const despues = (await (await tareas(ana)).json()) as TaskBody[];
    const revision = despues.find((t) => t.task === 'AGENT_REVIEW');

    expect(revision?.supported).toBe(false);
    expect(revision?.modelAvailable).toBe(false);
    /* El proveedor sigue sabiendo hacerlo: lo que falta es el modelo. */
    expect(revision?.missing).toEqual([]);

    await h.db.execute(
      sql`UPDATE ai_models SET available = true WHERE model_id = ${antes!.modelId!}`,
    );
  });
});

describe('cuando el proveedor se va', () => {
  /*
   * Una tarea apuntando a un proveedor que ya no está sería una invocación que
   * falla en el momento más inoportuno. Lo que queda es una tarea sin asignar,
   * que sí se puede explicar (RF-1006).
   */
  it('borrarlo deja sus tareas sin asignar, no rotas', async () => {
    await asignar(ana, 'AGENT_REPLY', { provider: 'ANTHROPIC', modelId: modeloValido });

    await h.as(ana).delete(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`);

    const body = (await (await tareas(ana)).json()) as TaskBody[];
    expect(body).toHaveLength(4);
    expect(body.every((t) => t.provider === null)).toBe(true);
  });
});
