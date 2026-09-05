import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Los agentes de una app: las instancias que firman.
 *
 * Lo que se comprueba es que instanciar copie y no ate —ajustar aquí no toca la
 * plantilla, ni al revés—, quién puede tocarlos, y los dos topes: el de agentes
 * por app y el del handle que ya tiene alguien.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;

/** La app abierta de Ana, que Bruno también puede editar. */
let appAbierta: string;
/** La privada de Ana, que Bruno no ve. */
let appPrivada: string;
let plantillaPO: string;

const agentes = (quien: TestUser, appId = appAbierta) =>
  h.as(quien).get(`/api/v1/apps/${appId}/agents`);

const añadir = (quien: TestUser, body: unknown, appId = appAbierta) =>
  h.as(quien).post(`/api/v1/apps/${appId}/agents`, body);

const ajustar = (quien: TestUser, agentId: string, body: unknown) =>
  h.as(quien).patch(`/api/v1/apps/${appAbierta}/agents/${agentId}`, body);

interface Agente {
  id: string;
  name: string;
  handle: string;
  prompt: string;
  promptRevision: number;
  active: boolean;
  template: { id: string; name: string; drifted: boolean } | null;
}

async function crearApp(quien: TestUser, name: string, accessLevel: string): Promise<string> {
  const res = await h.as(quien).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
    name,
    accessLevel,
  });
  return ((await res.json()) as { id: string }).id;
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });

  appAbierta = await crearApp(ana, 'Abierta', 'WORKSPACE_WRITE');
  appPrivada = await crearApp(ana, 'Privada', 'PRIVATE');

  const plantilla = (await (
    await h
      .as(ana)
      .post(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/catalog/product-owner`, {})
  ).json()) as { id: string };
  plantillaPO = plantilla.id;
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('instanciar una plantilla', () => {
  it('copia nombre, handle, icono y prompt, y arranca en la revisión 1', async () => {
    const res = await añadir(ana, { templateId: plantillaPO });
    expect(res.status).toBe(201);

    const agente = (await res.json()) as Agente;
    expect(agente.handle).toBe('po');
    expect(agente.name).toBe('Product Owner');
    expect(agente.promptRevision).toBe(1);
    expect(agente.prompt).toContain('product owner');
    expect(agente.template?.drifted).toBe(false);
  });

  it('lo hace quien pueda editar la app, aunque sea un invitado', async () => {
    const res = await añadir(bruno, { templateId: plantillaPO, handle: 'po-de-bruno' });
    expect(res.status).toBe(201);
  });

  it('sobre una app que no ve, no', async () => {
    const res = await añadir(bruno, { templateId: plantillaPO }, appPrivada);
    expect(res.status).toBe(404);
  });

  it('un extraño no llega ni a la app', async () => {
    expect((await agentes(carla)).status).toBe(404);
  });

  it('desde una plantilla de otro workspace, tampoco', async () => {
    const suya = (await (
      await h
        .as(carla)
        .post(`/api/v1/workspaces/${carla.workspaceId}/agent-templates/catalog/marketing`, {})
    ).json()) as { id: string };

    const res = await añadir(ana, { templateId: suya.id });
    expect(res.status).toBe(404);
  });
});

describe('el handle de un agente', () => {
  it('no se repite entre los que siguen en la app', async () => {
    const res = await añadir(ana, { templateId: plantillaPO, handle: 'po' });
    expect(res.status).toBe(409);
  });

  it('no puede ser el de una persona del workspace: la mención sería ambigua', async () => {
    const res = await añadir(ana, { templateId: plantillaPO, handle: 'bruno' });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('is a person in this workspace');
  });

  it('tiene que poder escribirse como mención', async () => {
    const res = await añadir(ana, { templateId: plantillaPO, handle: 'con punto.' });
    expect(res.status).toBe(400);
  });
});

describe('ajustar la instancia', () => {
  let elPO: string;

  beforeAll(async () => {
    const lista = (await (await agentes(ana)).json()) as Agente[];
    elPO = lista.find((a) => a.handle === 'po')!.id;
  });

  it('cambiar el prompt añade revisión, no reescribe la que hay', async () => {
    const res = await ajustar(ana, elPO, { prompt: 'Only ask about scope.' });
    expect(res.status).toBe(200);

    const tras = (await res.json()) as Agente;
    expect(tras.prompt).toBe('Only ask about scope.');
    expect(tras.promptRevision).toBe(2);
  });

  it('y entonces se dice que se apartó de su plantilla', async () => {
    const lista = (await (await agentes(ana)).json()) as Agente[];
    const po = lista.find((a) => a.id === elPO)!;
    expect(po.template?.drifted).toBe(true);
  });

  it('pero la plantilla sigue diciendo lo que decía', async () => {
    const plantillas = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/agent-templates`)
    ).json()) as { id: string; prompt: string }[];

    const molde = plantillas.find((p) => p.id === plantillaPO)!;
    expect(molde.prompt).not.toBe('Only ask about scope.');
    expect(molde.prompt).toContain('product owner');
  });

  it('editar la plantilla tampoco vuelve a la instancia', async () => {
    await h
      .as(ana)
      .patch(`/api/v1/workspaces/${ana.workspaceId}/agent-templates/${plantillaPO}`, {
        prompt: 'A brand new template prompt.',
      });

    const lista = (await (await agentes(ana)).json()) as Agente[];
    expect(lista.find((a) => a.id === elPO)!.prompt).toBe('Only ask about scope.');
  });

  it('adoptar el cambio de la plantilla es una decisión, y añade otra revisión', async () => {
    const res = await h.as(ana).post(`/api/v1/apps/${appAbierta}/agents/${elPO}/adopt-template`);
    expect(res.status).toBe(201);

    const tras = (await res.json()) as Agente;
    expect(tras.prompt).toBe('A brand new template prompt.');
    expect(tras.promptRevision).toBe(3);
    expect(tras.template?.drifted).toBe(false);
  });

  it('adoptarlo otra vez no hace nada: ya dice lo mismo', async () => {
    const res = await h.as(ana).post(`/api/v1/apps/${appAbierta}/agents/${elPO}/adopt-template`);
    expect(res.status).toBe(409);
  });

  it('callar sin retirar: sigue en la lista, y no interviene', async () => {
    const apagado = (await (await ajustar(ana, elPO, { active: false })).json()) as Agente;
    expect(apagado.active).toBe(false);

    const lista = (await (await agentes(ana)).json()) as Agente[];
    expect(lista.map((a) => a.id)).toContain(elPO);

    await ajustar(ana, elPO, { active: true });
  });

  it('un extraño no lo toca', async () => {
    expect((await ajustar(carla, elPO, { name: 'Mío' })).status).toBe(404);
  });
});

describe('el tope de agentes por app', () => {
  it('no deja pasar del quinto, y dice por qué', async () => {
    /* Ya hay dos: `po` y `po-de-bruno`. Faltan tres para el tope de cinco. */
    for (const handle of ['tres', 'cuatro', 'cinco']) {
      const res = await añadir(ana, { templateId: plantillaPO, handle });
      expect(res.status, handle).toBe(201);
    }

    const sexto = await añadir(ana, { templateId: plantillaPO, handle: 'seis' });
    expect(sexto.status).toBe(409);
    expect(await sexto.text()).toContain('which is the limit');
  });

  it('retirar a uno libera el sitio, y también su nombre', async () => {
    const lista = (await (await agentes(ana)).json()) as Agente[];
    const aRetirar = lista.find((a) => a.handle === 'cinco')!;

    const res = await h.as(ana).delete(`/api/v1/apps/${appAbierta}/agents/${aRetirar.id}`);
    expect(res.status).toBe(204);

    const quedan = (await (await agentes(ana)).json()) as Agente[];
    expect(quedan.map((a) => a.handle)).not.toContain('cinco');

    /* El nombre vuelve a estar libre: retirar no lo quema (RF-1506). */
    const reusando = await añadir(ana, { templateId: plantillaPO, handle: 'cinco' });
    expect(reusando.status).toBe(201);
  });
});

describe('la auditoría', () => {
  it('registra el alta, el ajuste y la retirada, sin una línea de prompt', async () => {
    const res = await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/audit`);
    const cuerpo = await res.text();

    expect(cuerpo).toContain('agent.added');
    expect(cuerpo).toContain('agent.updated');
    expect(cuerpo).toContain('agent.removed');
    expect(cuerpo).not.toContain('Only ask about scope');
    expect(cuerpo).not.toContain('brand new template prompt');
  });
});
