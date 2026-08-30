import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let extrana: TestUser;

interface Hit {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  excerpt: string | null;
}

async function buscar(user: TestUser, q: string): Promise<Hit[]> {
  const response = await h.as(user).get(`/api/v1/search?q=${encodeURIComponent(q)}`);
  return ((await response.json()) as { items: Hit[] }).items;
}

async function crearApp(
  user: TestUser,
  workspaceId: string,
  name: string,
  accessLevel: string,
  contenido?: string,
) {
  const created = await h.as(user).post(`/api/v1/workspaces/${workspaceId}/apps`, {
    name,
    accessLevel,
  });
  const app = (await created.json()) as { id: string };

  if (contenido) {
    const doc = (await (await h.as(user).get(`/api/v1/apps/${app.id}/document`)).json()) as {
      currentVersionId: string;
    };
    await h.as(user).put(`/api/v1/apps/${app.id}/document`, {
      content: contenido,
      baseVersionId: doc.currentVersionId,
    });
  }
  return app.id;
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  extrana = await h.createUser('extrana');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

  await crearApp(
    ana,
    ana.workspaceId,
    'Idea Board',
    'WORKSPACE_READ',
    '# The problem\n\nDeciding what to build next is pure guesswork.\n',
  );
  await crearApp(
    ana,
    ana.workspaceId,
    'Secreta de Ana',
    'PRIVATE',
    '# Contiene la palabra sigilo\n',
  );
  // Bruno tiene además su propio workspace, donde Ana no está.
  await crearApp(bruno, bruno.workspaceId, 'Cosa de Bruno', 'WORKSPACE_READ', '# También sigilo\n');
  // Una palabra que aparece en los dos workspaces de Bruno, para comprobar que
  // una sola búsqueda alcanza a ambos.
  await crearApp(
    bruno,
    bruno.workspaceId,
    'Notas de Bruno',
    'WORKSPACE_READ',
    '# Otra vez guesswork, aquí\n',
  );
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('qué encuentra', () => {
  it('por nombre', async () => {
    const hits = await buscar(ana, 'Idea');
    expect(hits.map((r) => r.name)).toContain('Idea Board');
  });

  it('por una palabra que solo está en el contenido', async () => {
    // Es la diferencia entre buscar y filtrar por título: lo que se escribió
    // dentro es justo lo que uno no recuerda dónde puso.
    const hits = await buscar(ana, 'guesswork');
    expect(hits.map((r) => r.name)).toContain('Idea Board');
  });

  it('por prefijo, sin tener que acertar la palabra entera', async () => {
    // Lo que compensa no reducir palabras a su raíz: escribir «guess» basta.
    const hits = await buscar(ana, 'guess');
    expect(hits.map((r) => r.name)).toContain('Idea Board');
  });

  it('exige todas las palabras, no cualquiera', async () => {
    // Quien escribe dos palabras está acotando, no ampliando.
    expect(await buscar(ana, 'Idea guesswork')).toHaveLength(1);
    expect(await buscar(ana, 'Idea palabraquenoexiste')).toHaveLength(0);
  });

  it('dice de qué workspace viene cada resultado', async () => {
    // RF-604: sin esto, dos apps con el mismo nombre en workspaces distintos
    // serían indistinguibles.
    const hits = await buscar(bruno, 'sigilo');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.workspaceName.length).toBeGreaterThan(0);
      expect(hit.workspaceId).toBeTruthy();
    }
  });

  it('cruza todos los workspaces del usuario', async () => {
    // Bruno está en el suyo y en el de Ana, y «guesswork» aparece en ambos: una
    // sola búsqueda tiene que traer los dos (RF-604).
    const hits = await buscar(bruno, 'guesswork');
    const workspaces = new Set(hits.map((r) => r.workspaceId));

    expect(hits.map((r) => r.name).sort()).toEqual(['Idea Board', 'Notas de Bruno']);
    expect(workspaces.size).toBe(2);
  });

  it('devuelve un trozo del texto donde aparece', async () => {
    const [hit] = await buscar(ana, 'guesswork');
    expect(hit!.excerpt).toContain('«guesswork»');
  });
});

describe('qué no enseña', () => {
  it('una app privada ajena no aparece ni buscándola por su nombre exacto', async () => {
    // Lo más importante de esta pieza. La consulta no lleva ningún filtro de
    // permisos escrito a mano: pasa por las mismas políticas que el listado.
    expect(await buscar(bruno, 'Secreta de Ana')).toHaveLength(0);
    expect(await buscar(bruno, 'sigilo')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Secreta de Ana' })]),
    );
  });

  it('quien no comparte nada no encuentra nada', async () => {
    expect(await buscar(extrana, 'Idea')).toHaveLength(0);
    expect(await buscar(extrana, 'guesswork')).toHaveLength(0);
  });

  it('su dueña sí la encuentra', async () => {
    // Para que el test anterior signifique algo: la app existe y es hallable.
    expect((await buscar(ana, 'sigilo')).map((r) => r.name)).toContain('Secreta de Ana');
  });
});

describe('qué se le puede escribir', () => {
  it('una consulta vacía no devuelve nada, en vez de devolverlo todo', async () => {
    expect(await buscar(ana, '')).toHaveLength(0);
    expect(await buscar(ana, '   ')).toHaveLength(0);
  });

  it('los símbolos de la sintaxis de Postgres no rompen la búsqueda', async () => {
    // `to_tsquery` revienta ante un `&` suelto o un paréntesis sin cerrar, así
    // que lo tecleado no puede llegarle tal cual.
    for (const raro of ['&', '|', '!', ':*', '((', 'a & | b', "'; DROP TABLE apps; --"]) {
      const response = await h.as(ana).get(`/api/v1/search?q=${encodeURIComponent(raro)}`);
      expect(response.status).toBe(200);
    }

    // Y las apps siguen ahí.
    expect((await buscar(ana, 'Idea')).length).toBeGreaterThan(0);
  });
});
