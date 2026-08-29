import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notifications } from '@app-foundry/db';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;
let appId: string;

/**
 * Los avisos de alguien, leídos con su identidad.
 *
 * Se leen así y no como superusuario a propósito: comprobar lo que ve cada uno
 * con sus propias políticas es la mitad de lo que hay que verificar.
 */
async function avisosDe(user: TestUser) {
  return h.db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${user.id}, true)`);
    return tx.select().from(notifications).orderBy(notifications.createdAt);
  });
}

async function documento() {
  const response = await h.as(ana).get(`/api/v1/apps/${appId}/document`);
  return (await response.json()) as { content: string; currentVersionId: string };
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });
  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: carla.email });

  const created = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
    name: 'Comentada',
    accessLevel: 'WORKSPACE_WRITE',
  });
  appId = ((await created.json()) as { id: string }).id;
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('invitar', () => {
  it('avisa a quien ya tenía cuenta', async () => {
    const suyos = await avisosDe(bruno);
    const invitacion = suyos.filter((n) => n.type === 'WORKSPACE_INVITED');

    expect(invitacion).toHaveLength(1);
    expect(invitacion[0]!.payload).toMatchObject({ actorHandle: 'ana' });
  });

  it('y no avisa a quien invita', async () => {
    const suyos = await avisosDe(ana);
    expect(suyos.filter((n) => n.type === 'WORKSPACE_INVITED')).toHaveLength(0);
  });
});

describe('comentar', () => {
  it('avisa al precursor, con un trozo de lo escrito', async () => {
    await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, { body: '¿Y el coste de esto?' });

    const suyos = await avisosDe(ana);
    const aviso = suyos.find((n) => n.type === 'APP_COMMENTED');

    expect(aviso).toBeDefined();
    expect(aviso!.appId).toBe(appId);
    expect(aviso!.payload).toMatchObject({
      actorHandle: 'bruno',
      appName: 'Comentada',
      excerpt: '¿Y el coste de esto?',
    });
  });

  it('comentar en tu propia app no te avisa a ti', async () => {
    const antesAna = (await avisosDe(ana)).length;
    const antesBruno = (await avisosDe(bruno)).length;

    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Nota para mí' });

    // Ana es la precursora, así que sin la exclusión se avisaría a sí misma.
    expect((await avisosDe(ana)).length).toBe(antesAna);
    // Y a Bruno, que ya se implicó en la app, sí le llega.
    expect((await avisosDe(bruno)).length).toBe(antesBruno + 1);
  });

  it('responder avisa a quien está en ese hilo', async () => {
    const creado = await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Un hilo de Bruno',
    });
    const hilo = (await creado.json()) as { id: string };

    const antes = (await avisosDe(bruno)).length;
    await h.as(carla).post(`/api/v1/threads/${hilo.id}/comments`, { body: 'Yo lo veo así' });

    const suyos = await avisosDe(bruno);
    expect(suyos.length).toBe(antes + 1);
    expect(suyos.at(-1)!.type).toBe('THREAD_REPLIED');
    expect(suyos.at(-1)!.threadId).toBe(hilo.id);
  });

  it('resolver avisa a quien abrió el hilo', async () => {
    const creado = await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Algo que resolver',
    });
    const hilo = (await creado.json()) as { id: string };

    await h.as(ana).post(`/api/v1/threads/${hilo.id}/resolve`);

    const suyos = await avisosDe(bruno);
    expect(suyos.at(-1)!.type).toBe('THREAD_RESOLVED');
  });
});

describe('menciones', () => {
  it('alcanzan a quien no participa en el hilo', async () => {
    // RF-908: te mencionan para traerte, así que no puede exigir estar ya.
    const antes = (await avisosDe(carla)).length;
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Esto lo sabe @carla mejor que yo',
    });

    const suyos = await avisosDe(carla);
    expect(suyos.length).toBe(antes + 1);
    expect(suyos.at(-1)!.type).toBe('MENTIONED');
  });
});

describe('guardar una versión', () => {
  it('avisa a quien se ha implicado en la app', async () => {
    const antes = (await avisosDe(bruno)).length;

    const doc = await documento();
    await h.as(ana).put(`/api/v1/apps/${appId}/document`, {
      content: `${doc.content}\n\nUn párrafo nuevo.\n`,
      baseVersionId: doc.currentVersionId,
      message: 'Añado el coste',
    });

    const suyos = await avisosDe(bruno);
    expect(suyos.length).toBe(antes + 1);
    expect(suyos.at(-1)!.type).toBe('DOCUMENT_VERSION_SAVED');
    expect(suyos.at(-1)!.payload).toMatchObject({ message: 'Añado el coste', versionNo: 2 });
  });
});

describe('la acción manda', () => {
  it('si la acción se deshace, el aviso tampoco existe', async () => {
    // Un comentario sobre un fragmento que ya no cuadra se rechaza entero. Como
    // el aviso va en la misma transacción, no puede quedarse suelto anunciando
    // algo que nunca llegó a pasar.
    const antes = (await avisosDe(ana)).length;

    const response = await h.as(bruno).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Sobre esto',
      quote: 'un texto que no está en el documento',
      start: 0,
      end: 10,
    });
    expect(response.status).toBe(403);

    expect((await avisosDe(ana)).length).toBe(antes);
  });

  it('nadie ve los avisos de otro', async () => {
    const suyos = await avisosDe(carla);
    expect(suyos.every((n) => n.userId === carla.id)).toBe(true);
  });
});
