import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let ana: TestUser;

interface Listado {
  items: {
    id: string;
    name: string;
    status: string;
    isArchived: boolean;
    tags: string[];
    openThreads: number;
  }[];
  total: number;
  page: number;
  perPage: number;
  availableTags: string[];
}

async function listar(query = ''): Promise<Listado> {
  const response = await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/apps${query}`);
  return (await response.json()) as Listado;
}

async function crear(name: string, status: string, tags: string[] = []) {
  const created = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, { name });
  const app = (await created.json()) as { id: string };
  await h.as(ana).patch(`/api/v1/apps/${app.id}`, { status, tags });
  return app.id;
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');

  await crear('Alfa', 'IDEA', ['motor']);
  await crear('Beta', 'DEFINING', ['motor', 'interfaz']);
  await crear('Gamma', 'DEFINING', ['interfaz']);
  await crear('Delta', 'PAUSED', []);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('filtrar', () => {
  it('por estado', async () => {
    const { items, total } = await listar('?status=DEFINING');
    expect(items.map((a) => a.name).sort()).toEqual(['Beta', 'Gamma']);
    expect(total).toBe(2);
  });

  it('por varios estados a la vez', async () => {
    const { items } = await listar('?status=IDEA,PAUSED');
    expect(items.map((a) => a.name).sort()).toEqual(['Alfa', 'Delta']);
  });

  it('por etiqueta', async () => {
    const { items } = await listar('?tag=motor');
    expect(items.map((a) => a.name).sort()).toEqual(['Alfa', 'Beta']);
  });

  it('dos etiquetas exigen ambas, no cualquiera', async () => {
    // Filtrar es acotar: quien marca dos espera lo que cumple las dos.
    const { items } = await listar('?tag=motor,interfaz');
    expect(items.map((a) => a.name)).toEqual(['Beta']);
  });

  it('combinar filtros acota más, no se estorban', async () => {
    const { items } = await listar('?status=DEFINING&tag=motor');
    expect(items.map((a) => a.name)).toEqual(['Beta']);
  });

  it('ofrece las etiquetas que existen, para poder pintar el filtro', async () => {
    const { availableTags } = await listar();
    expect(availableTags).toEqual(['interfaz', 'motor']);
  });
});

describe('archivadas', () => {
  it('no aparecen entre las demás', async () => {
    // Archivar es decir «esto ya no está en marcha»: si siguieran saliendo, no
    // habría servido de nada.
    const antes = await listar();
    const alfa = antes.items.find((a) => a.name === 'Alfa')!;
    await h.as(ana).post(`/api/v1/apps/${alfa.id}/archive`);

    const despues = await listar();
    expect(despues.items.map((a) => a.name)).not.toContain('Alfa');
    expect(despues.total).toBe(antes.total - 1);
  });

  it('pero se pueden ver pidiéndolas', async () => {
    const solo = await listar('?archived=only');
    expect(solo.items.map((a) => a.name)).toEqual(['Alfa']);

    const todas = await listar('?archived=all');
    expect(todas.items.map((a) => a.name)).toContain('Alfa');
  });
});

describe('ordenar', () => {
  it('por defecto, lo último tocado arriba', async () => {
    const { items } = await listar('?archived=all');
    // Alfa acaba de archivarse, así que es lo más reciente.
    expect(items[0]!.name).toBe('Alfa');
  });

  it('por nombre', async () => {
    const { items } = await listar('?archived=all&sort=name');
    expect(items.map((a) => a.name)).toEqual(['Alfa', 'Beta', 'Delta', 'Gamma']);
  });
});

describe('paginar', () => {
  it('trae solo la página pedida, pero cuenta el total', async () => {
    // El total no puede salir de la página: es lo que dice cuántas hay.
    const primera = await listar('?archived=all&sort=name&perPage=2&page=1');
    expect(primera.items.map((a) => a.name)).toEqual(['Alfa', 'Beta']);
    expect(primera.total).toBe(4);

    const segunda = await listar('?archived=all&sort=name&perPage=2&page=2');
    expect(segunda.items.map((a) => a.name)).toEqual(['Delta', 'Gamma']);
    expect(segunda.total).toBe(4);
  });

  it('una página más allá del final no falla, viene vacía', async () => {
    const { items, total } = await listar('?archived=all&perPage=2&page=99');
    expect(items).toHaveLength(0);
    expect(total).toBe(4);
  });

  it('se planta ante un tamaño de página desmedido', async () => {
    // Sin tope, un `perPage=100000` traería el workspace entero de una vez.
    const { perPage } = await listar('?perPage=100000');
    expect(perPage).toBe(100);
  });
});

describe('conversaciones abiertas (RF-811)', () => {
  it('el listado dice cuántas tiene cada app', async () => {
    const { items } = await listar('?archived=all');
    const beta = items.find((a) => a.name === 'Beta')!;
    expect(beta.openThreads).toBe(0);

    await h.as(ana).post(`/api/v1/apps/${beta.id}/threads`, { body: 'Una duda' });
    await h.as(ana).post(`/api/v1/apps/${beta.id}/threads`, { body: 'Y otra' });

    const despues = await listar('?archived=all');
    expect(despues.items.find((a) => a.name === 'Beta')!.openThreads).toBe(2);
  });

  it('no cuenta las resueltas: lo que importa es lo que sigue esperando', async () => {
    const { items } = await listar('?archived=all');
    const beta = items.find((a) => a.name === 'Beta')!;
    const hilos = (await (await h.as(ana).get(`/api/v1/apps/${beta.id}/threads`)).json()) as {
      id: string;
    }[];

    await h.as(ana).post(`/api/v1/threads/${hilos[0]!.id}/resolve`);

    const despues = await listar('?archived=all');
    expect(despues.items.find((a) => a.name === 'Beta')!.openThreads).toBe(1);
  });
});
