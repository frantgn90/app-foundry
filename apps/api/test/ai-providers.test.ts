import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * Configurar un proveedor de IA, a través de HTTP.
 *
 * Habla con el proveedor de mentira y cifra con un llavero de juguete, pero todo
 * lo demás es el camino real: permisos, políticas, cifrado y la función acotada
 * que lee el secreto (T-36).
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let carla: TestUser;

const CLAVE = 'sk-de-mentira-pero-larga';

const ruta = (user: TestUser, provider = 'ANTHROPIC') =>
  `/api/v1/workspaces/${user.workspaceId}/ai/providers/${provider}`;

interface ProviderBody {
  provider: string;
  status: string;
  capabilities: Record<string, boolean>;
  credentialHint?: string;
  monthlyTokenQuota?: number | null;
  verifiedAt?: string | null;
}

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  carla = await h.createUser('carla');

  /* Ana invita a Bruno, que ya tiene cuenta y entra en el acto. Carla queda fuera. */
  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('antes de nada, la advertencia', () => {
  /*
   * RF-1011: configurar un proveedor es empezar a mandar el contenido de las
   * apps a un tercero, y eso se acepta a sabiendas o no se hace.
   */
  it('sin aceptar el envío a terceros no se puede configurar nada', async () => {
    const response = await h.as(ana).put(ruta(ana), { apiKey: CLAVE });

    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/tercero/i);
  });

  it('la aceptación queda con nombre y fecha', async () => {
    const response = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
    const body = (await response.json()) as {
      accepted: boolean;
      acceptedAt: string | null;
      acceptedBy: string | null;
    };

    expect(body.accepted).toBe(true);
    expect(body.acceptedBy).toBe('ana');
    expect(body.acceptedAt).not.toBeNull();
  });

  it('aceptar dos veces no cambia quién ni cuándo', async () => {
    const primera = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`)
    ).json()) as { acceptedAt: string };

    await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);

    const segunda = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`)
    ).json()) as { acceptedAt: string };

    expect(segunda.acceptedAt).toBe(primera.acceptedAt);
  });

  it('no la acepta un miembro por el dueño', async () => {
    const response = await h.as(bruno).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);

    expect(response.status).toBe(403);
  });
});

describe('configurar un proveedor', () => {
  it('el dueño lo configura y queda activo', async () => {
    const response = await h.as(ana).put(ruta(ana), { apiKey: CLAVE });
    const body = (await response.json()) as ProviderBody;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ACTIVE');
    expect(body.verifiedAt).not.toBeNull();
  });

  /* RF-1005: una clave que el proveedor rechaza no se guarda, y se dice por qué. */
  it('una clave rechazada no se guarda', async () => {
    const response = await h.as(ana).put(ruta(ana, 'GROQ'), { apiKey: 'sk-invalid-pero-larga' });

    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/rechaz/i);

    const lista = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`)
    ).json()) as ProviderBody[];
    expect(lista.map((p) => p.provider)).not.toContain('GROQ');
  });

  it('la clave no vuelve nunca, solo su pista', async () => {
    const body = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`)
    ).json()) as ProviderBody[];

    const texto = JSON.stringify(body);
    expect(texto).not.toContain(CLAVE);
    expect(body[0]?.credentialHint).toBe(CLAVE.slice(-4));
  });

  it('las capacidades viajan, para poder dibujar la interfaz con ellas', async () => {
    const body = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`)
    ).json()) as ProviderBody[];

    expect(body[0]?.capabilities).toMatchObject({ schemaOutput: true, webSearch: true });
  });
});

describe('quién puede qué', () => {
  it('un miembro ve que hay proveedor, pero no lo que es del dueño', async () => {
    const response = await h.as(bruno).get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`);
    const body = (await response.json()) as ProviderBody[];

    expect(response.status).toBe(200);
    expect(body[0]?.status).toBe('ACTIVE');
    /* El cupo y la pista son asuntos de quien paga (RF-1002). */
    expect(body[0]?.credentialHint).toBeUndefined();
    expect(body[0]?.monthlyTokenQuota).toBeUndefined();
  });

  it('un miembro no puede configurar nada', async () => {
    const response = await h.as(bruno).put(ruta(ana, 'GROQ'), { apiKey: CLAVE });

    expect(response.status).toBe(403);
  });

  it('un miembro no puede apagarlo ni borrarlo', async () => {
    expect((await h.as(bruno).patch(ruta(ana), { status: 'DISABLED' })).status).toBe(403);
    expect((await h.as(bruno).delete(ruta(ana))).status).toBe(403);
  });

  it('un extraño ni siquiera sabe que el workspace existe', async () => {
    const response = await h.as(carla).get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`);

    expect(response.status).toBe(404);
  });

  it('sin sesión no se entra', async () => {
    const response = await h.anonymous().get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`);

    expect(response.status).toBe(401);
  });
});

describe('apagar, encender y borrar', () => {
  it('apagar deja la configuración donde estaba', async () => {
    const response = await h.as(ana).patch(ruta(ana), { status: 'DISABLED' });
    const body = (await response.json()) as ProviderBody;

    expect(body.status).toBe('DISABLED');
    expect(body.credentialHint).toBe(CLAVE.slice(-4));
  });

  /*
   * Encender no es fiarse: si la credencial dejó de valer mientras estaba
   * apagado, activarlo sin comprobar deja un proveedor «activo» que falla en la
   * primera invocación.
   */
  it('encender vuelve a comprobar la credencial', async () => {
    const response = await h.as(ana).patch(ruta(ana), { status: 'ACTIVE' });
    const body = (await response.json()) as ProviderBody;

    expect(body.status).toBe('ACTIVE');
    expect(body.verifiedAt).not.toBeNull();
  });

  it('borrar se lleva la configuración', async () => {
    expect((await h.as(ana).delete(ruta(ana))).status).toBe(204);

    const lista = (await (
      await h.as(ana).get(`/api/v1/workspaces/${ana.workspaceId}/ai/providers`)
    ).json()) as ProviderBody[];
    expect(lista).toHaveLength(0);
  });

  it('borrar lo que no hay es un 404, no un silencio', async () => {
    expect((await h.as(ana).delete(ruta(ana))).status).toBe(404);
  });
});
