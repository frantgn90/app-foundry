import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Las plantillas de agente: el molde que vive en el workspace.
 *
 * Lo que se comprueba aquí es **quién puede qué**, que es donde está la regla
 * (RF-1502), y que editar el molde no se lleve nada por delante.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;

const PO = {
  name: 'Product Owner',
  handle: 'po',
  iconEmoji: '🎯',
  iconColor: 'amber',
  prompt: 'Ask what problem this solves, and for whom.',
};

const plantillas = (quien: TestUser) =>
  h.as(quien).get(`/api/v1/workspaces/${ana.workspaceId}/agent-templates`);

const crear = (quien: TestUser, body: unknown) =>
  h.as(quien).post(`/api/v1/workspaces/${ana.workspaceId}/agent-templates`, body);

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('quién las crea', () => {
  it('el dueño del workspace', async () => {
    const res = await crear(ana, PO);
    expect(res.status).toBe(201);

    const creada = (await res.json()) as { handle: string; prompt: string; model: unknown };
    expect(creada.handle).toBe('po');
    expect(creada.model).toBeNull();
  });

  it('un miembro que no es dueño, no: crear una plantilla es cosa suya', async () => {
    const res = await crear(bruno, { ...PO, handle: 'de-bruno' });
    expect(res.status).toBe(403);
  });

  it('un extraño ni siquiera sabe que el workspace existe', async () => {
    const res = await crear(carla, { ...PO, handle: 'de-carla' });
    expect(res.status).toBe(404);
  });
});

describe('el handle', () => {
  it('no se repite en el mismo workspace, y se dice con un 409', async () => {
    const res = await crear(ana, { ...PO, name: 'Otro' });
    expect(res.status).toBe(409);
  });

  it('tampoco cambiando las mayúsculas: `@PO` llama al mismo', async () => {
    const res = await crear(ana, { ...PO, handle: 'PO' });
    expect(res.status).toBe(409);
  });

  it('tiene que poder escribirse como mención, o el agente sería ininvocable', async () => {
    for (const handle of ['con espacio', '-empieza-en-guion', 'termina-en-guion-', 'con.punto']) {
      const res = await crear(ana, { ...PO, handle });
      expect(res.status, handle).toBe(400);
    }
  });
});

describe('el catálogo de fábrica', () => {
  const catalogo = (quien: TestUser) =>
    h.as(quien).get(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/catalog`);

  const adoptar = (quien: TestUser, key: string) =>
    h.as(quien).post(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/catalog/${key}`);

  it('trae los seis perfiles, con su resumen y su prompt', async () => {
    const res = await catalogo(ana);
    expect(res.status).toBe(200);

    const perfiles = (await res.json()) as { key: string; summary: string; prompt: string }[];
    expect(perfiles).toHaveLength(6);
    expect(perfiles.map((p) => p.key)).toContain('tech-lead');
    expect(perfiles.every((p) => p.summary.length > 0 && p.prompt.length > 0)).toBe(true);
  });

  it('lo ve cualquier miembro, aunque adoptar no sea cosa suya', async () => {
    expect((await catalogo(bruno)).status).toBe(200);
  });

  it('adoptar uno lo copia al workspace', async () => {
    const res = await adoptar(ana, 'tech-lead');
    expect(res.status).toBe(201);

    const copia = (await res.json()) as { id: string; handle: string; prompt: string };
    expect(copia.handle).toBe('techlead');
    expect(copia.prompt).toContain('tech lead');

    const propias = (await (await plantillas(ana)).json()) as { handle: string }[];
    expect(propias.map((p) => p.handle)).toContain('techlead');
  });

  it('y ahí se corta el vínculo: editar la copia no toca el catálogo', async () => {
    const propias = (await (await plantillas(ana)).json()) as { id: string; handle: string }[];
    const copia = propias.find((p) => p.handle === 'techlead')!;

    await h.as(ana).patch(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/${copia.id}`, {
      prompt: 'Mine now.',
    });

    const perfiles = (await (await catalogo(ana)).json()) as { key: string; prompt: string }[];
    const original = perfiles.find((p) => p.key === 'tech-lead')!;
    expect(original.prompt).not.toBe('Mine now.');
    expect(original.prompt).toContain('tech lead');
  });

  it('un perfil que no existe no se adopta', async () => {
    expect((await adoptar(ana, 'no-existe')).status).toBe(404);
  });

  it('adoptar es crear una plantilla, así que un miembro no puede', async () => {
    const res = await adoptar(bruno, 'marketing');
    expect(res.status).toBe(403);

    const propias = (await (await plantillas(ana)).json()) as { handle: string }[];
    expect(propias.map((p) => p.handle)).not.toContain('marketing');
  });

  it('ni un extraño, que ni siquiera ve el catálogo', async () => {
    expect((await catalogo(carla)).status).toBe(404);
    expect((await adoptar(carla, 'marketing')).status).toBe(404);
  });
});

describe('quién las ve', () => {
  it('cualquier miembro, porque sin verlas no podría instanciar ninguna', async () => {
    const res = await plantillas(bruno);
    expect(res.status).toBe(200);

    const suyas = (await res.json()) as { handle: string }[];
    expect(suyas.map((p) => p.handle)).toEqual(['po', 'techlead']);
  });

  it('un extraño no ve el workspace, así que tampoco sus plantillas', async () => {
    expect((await plantillas(carla)).status).toBe(404);
  });
});

describe('editarlas', () => {
  let laDeAna: string;

  beforeAll(async () => {
    const lista = (await (await plantillas(ana)).json()) as { id: string }[];
    laDeAna = lista[0]!.id;
  });

  const editar = (quien: TestUser, body: unknown) =>
    h.as(quien).patch(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/${laDeAna}`, body);

  it('se cambia lo que se manda y lo demás se queda', async () => {
    const res = await editar(ana, { prompt: 'And who would say no to it.' });
    expect(res.status).toBe(200);

    const tras = (await res.json()) as { prompt: string; name: string; handle: string };
    expect(tras.prompt).toBe('And who would say no to it.');
    expect(tras.name).toBe('Product Owner');
    expect(tras.handle).toBe('po');
  });

  it('se le puede fijar un modelo propio, y quitarlo', async () => {
    const conModelo = (await (
      await editar(ana, { model: { provider: 'ANTHROPIC', modelId: 'claude-opus-5' } })
    ).json()) as { model: { modelId: string } | null };
    expect(conModelo.model?.modelId).toBe('claude-opus-5');

    const sinModelo = (await (await editar(ana, { model: null })).json()) as { model: unknown };
    expect(sinModelo.model).toBeNull();
  });

  it('a medias no: un proveedor sin modelo no dice cuál', async () => {
    const res = await editar(ana, { model: { provider: 'ANTHROPIC' } });
    expect(res.status).toBe(400);
  });

  it('un miembro que no es dueño no la edita', async () => {
    expect((await editar(bruno, { prompt: 'Reescrito.' })).status).toBe(403);
  });
});

describe('borrarlas', () => {
  it('la borra el dueño, y deja de aparecer', async () => {
    const creada = (await (await crear(ana, { ...PO, handle: 'efimera' })).json()) as {
      id: string;
    };

    const res = await h
      .as(ana)
      .delete(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/${creada.id}`);
    expect(res.status).toBe(204);

    const quedan = (await (await plantillas(ana)).json()) as { handle: string }[];
    expect(quedan.map((p) => p.handle)).not.toContain('efimera');
  });

  it('un miembro que no es dueño no la borra', async () => {
    const lista = (await (await plantillas(ana)).json()) as { id: string }[];
    const res = await h
      .as(bruno)
      .delete(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/${lista[0]!.id}`);
    expect(res.status).toBe(403);
  });
});

describe('la auditoría', () => {
  it('registra el alta, la edición y el borrado', async () => {
    const res = await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/audit`);
    const cuerpo = await res.text();

    expect(cuerpo).toContain('agent.template_created');
    expect(cuerpo).toContain('agent.template_updated');
    expect(cuerpo).toContain('agent.template_deleted');
  });

  it('y de un prompt guarda que cambió, nunca lo que dice', async () => {
    /*
     * Se mira la tabla entera y no la respuesta de una ruta: lo que RF-1703
     * prohíbe es que el texto **exista** en la auditoría, no que se enseñe. Con
     * la ruta bastaría cambiarle el DTO para que el test siguiera pasando con
     * el prompt guardado debajo.
     */
    const filas = await h.db.execute<{ todo: string }>(
      sql`SELECT coalesce(metadata::text, '') AS todo FROM audit_log`,
    );
    const auditoria = filas.rows.map((f) => f.todo).join(' ');

    expect(auditoria).toContain('promptChanged');
    expect(auditoria).not.toContain('what problem this solves');
    expect(auditoria).not.toContain('who would say no');
  });
});
