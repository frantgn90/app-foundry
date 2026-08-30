import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLog, notifications } from '@app-foundry/db';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;

async function crearApp(user: TestUser, workspaceId: string, name: string) {
  const created = await h.as(user).post(`/api/v1/workspaces/${workspaceId}/apps`, { name });
  return ((await created.json()) as { id: string }).id;
}

async function precursorDe(appId: string): Promise<string> {
  const filas = await h.db.execute<{ precursor_id: string }>(
    sql`SELECT precursor_id FROM apps WHERE id = ${appId}`,
  );
  return filas.rows[0]!.precursor_id;
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  for (const invitado of [bruno, carla]) {
    await h
      .as(ana)
      .post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: invitado.email });
  }
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('al marcharse por su cuenta', () => {
  it('sus apps pasan al dueño del workspace', async () => {
    // RF-413: la app se queda donde nació; lo que cambia es quién responde de
    // ella. Sin esto quedaría con un precursor que ya no es miembro, y nadie
    // podría cambiarle el nivel de acceso ni volver a transferirla.
    const app = await crearApp(bruno, ana.workspaceId, 'De Bruno');
    expect(await precursorDe(app)).toBe(bruno.id);

    await h.as(bruno).post(`/api/v1/workspaces/${ana.workspaceId}/leave`);

    expect(await precursorDe(app)).toBe(ana.id);
  });

  it('y el dueño se entera, con los nombres de lo que hereda', async () => {
    const avisos = await h.db.select().from(notifications).where(eq(notifications.userId, ana.id));
    const heredado = avisos.find((n) => n.type === 'APPS_INHERITED');

    expect(heredado).toBeDefined();
    expect(heredado!.payload).toMatchObject({ count: 1, appNames: ['De Bruno'] });
  });

  it('queda registrado quién lo dejó y quién lo recibe', async () => {
    const entradas = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'app.precursor_inherited'));

    expect(entradas).toHaveLength(1);
    expect(entradas[0]!.metadata).toMatchObject({ from: bruno.id, to: ana.id });
  });

  it('el historial sigue atribuido a quien lo escribió', async () => {
    // Heredar el rol no reescribe el pasado (RF-413).
    const filas = await h.db.execute<{ author_id: string }>(
      sql`SELECT v.author_id FROM document_versions v
          JOIN documents d ON d.id = v.document_id
          JOIN apps a ON a.id = d.app_id
         WHERE a.name = 'De Bruno'`,
    );
    expect(filas.rows.every((f) => f.author_id === bruno.id)).toBe(true);
  });
});

describe('al ser expulsado', () => {
  it('pasa lo mismo, aunque quien expulsa no sea el precursor', async () => {
    // Este es el caso que obliga a que la herencia sea del sistema: el dueño no
    // puede tocar una app ajena, y las políticas se lo impedirían con razón.
    const app = await crearApp(carla, ana.workspaceId, 'De Carla');

    await h.as(ana).delete(`/api/v1/workspaces/${ana.workspaceId}/members/${carla.id}`);

    expect(await precursorDe(app)).toBe(ana.id);
  });
});

describe('lo que no cambia', () => {
  it('la app se queda en el workspace, no se borra ni se mueve', async () => {
    const { items } = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as { items: { name: string }[] };

    expect(items.map((a) => a.name).sort()).toEqual(['De Bruno', 'De Carla']);
  });

  it('el dueño hereda también el poder cambiar el nivel de acceso', async () => {
    // Antes no podía: no era el precursor. Ahora sí, y es la consecuencia
    // práctica de heredar (RF-413).
    const { items } = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/apps`)
    ).json()) as { items: { id: string; name: string }[] };
    const app = items.find((a) => a.name === 'De Bruno')!;

    const response = await h.as(ana).patch(`/api/v1/apps/${app.id}/access-level`, {
      accessLevel: 'WORKSPACE_READ',
    });

    expect(response.status).toBeLessThan(300);
  });
});
