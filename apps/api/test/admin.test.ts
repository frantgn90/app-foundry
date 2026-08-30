import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Harness, startHarness, type TestUser } from './harness.js';

let h: Harness;
let jefa: TestUser;
let normal: TestUser;
let otra: TestUser;
/** Nunca se desactiva: sirve para comprobar el 403 con una sesión que sí vale. */
let mirona: TestUser;

interface Cuenta {
  id: string;
  handle: string;
  platformRole: string;
  status: string;
  workspaceCount: number;
  isMe: boolean;
}

async function hacerAdmin(user: TestUser) {
  // Se hace por fuera, como el arranque en frío de la instancia: no hay forma
  // de nombrar al primer administrador desde dentro.
  await h.db.execute(sql`UPDATE users SET platform_role = 'ADMIN' WHERE id = ${user.id}::uuid`);
}

async function cuentas(user: TestUser) {
  const response = await h.as(user).get('/api/v1/admin/users');
  return { status: response.status, body: (await response.json()) as Cuenta[] };
}

beforeAll(async () => {
  h = await startHarness();
  jefa = await h.createUser('jefa');
  normal = await h.createUser('normal');
  otra = await h.createUser('otra');
  mirona = await h.createUser('mirona');
  await hacerAdmin(jefa);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('quién entra', () => {
  it('un administrador lista todas las cuentas', async () => {
    const { status, body } = await cuentas(jefa);
    expect(status).toBe(200);
    expect(body.map((u) => u.handle).sort()).toEqual(['jefa', 'mirona', 'normal', 'otra']);
  });

  it('quien no lo es, no', async () => {
    const { status } = await cuentas(normal);
    expect(status).toBe(403);
  });

  it('el listado dice en cuántos workspaces está cada uno, no en cuáles', async () => {
    // El administrador de la instancia no accede al contenido de workspaces
    // ajenos, y el nombre de un workspace ya dice algo de él (D-6).
    const { body } = await cuentas(jefa);
    const fila = body.find((u) => u.handle === 'normal')!;

    expect(fila.workspaceCount).toBe(1);
    expect(JSON.stringify(fila)).not.toContain('workspace de');
  });

  it('el rol se mira en cada petición, no en la sesión', async () => {
    // Si el rol viniera de la sesión, a quien se lo retiran seguiría entrando
    // hasta que le caducara.
    await hacerAdmin(otra);
    expect((await cuentas(otra)).status).toBe(200);

    await h.db.execute(sql`UPDATE users SET platform_role = 'MEMBER' WHERE id = ${otra.id}::uuid`);
    expect((await cuentas(otra)).status).toBe(403);
  });
});

describe('cambiar cuentas', () => {
  it('promover y degradar', async () => {
    const promovido = await h.as(jefa).patch(`/api/v1/admin/users/${normal.id}`, {
      platformRole: 'ADMIN',
    });
    expect(((await promovido.json()) as Cuenta).platformRole).toBe('ADMIN');

    const degradado = await h.as(jefa).patch(`/api/v1/admin/users/${normal.id}`, {
      platformRole: 'MEMBER',
    });
    expect(((await degradado.json()) as Cuenta).platformRole).toBe('MEMBER');
  });

  it('la instancia no puede quedarse sin ningún administrador activo', async () => {
    // Es la garantía que impide dejar la instancia inadministrable, y vive en la
    // base de datos: comprobarla en el servicio dejaría una carrera entre dos
    // administradores quitándose el rol a la vez.
    const response = await h.as(jefa).patch(`/api/v1/admin/users/${jefa.id}`, {
      platformRole: 'MEMBER',
    });

    expect(response.status).toBe(409);
    expect((await cuentas(jefa)).status).toBe(200);
  });

  it('tampoco desactivándose', async () => {
    const response = await h.as(jefa).patch(`/api/v1/admin/users/${jefa.id}`, {
      status: 'DEACTIVATED',
    });
    expect(response.status).toBe(409);
  });

  it('desactivar cierra el paso en el acto, no cuando caduque la sesión', async () => {
    // RF-203: las sesiones abiertas se borran en la misma transacción.
    expect((await h.as(normal).get('/api/v1/auth/me')).status).toBe(200);

    await h.as(jefa).patch(`/api/v1/admin/users/${normal.id}`, { status: 'DEACTIVATED' });

    expect((await h.as(normal).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('y desactivar no borra nada de lo suyo', async () => {
    // RF-203: el contenido y la autoría se conservan.
    const filas = await h.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM workspaces WHERE owner_id = ${normal.id}::uuid`,
    );
    expect(Number(filas.rows[0]!.n)).toBe(1);
  });

  it('reactivar devuelve la cuenta', async () => {
    const response = await h.as(jefa).patch(`/api/v1/admin/users/${normal.id}`, {
      status: 'ACTIVE',
    });
    expect(((await response.json()) as Cuenta).status).toBe('ACTIVE');
  });
});

describe('métricas', () => {
  it('son números, no contenido', async () => {
    const response = await h.as(jefa).get('/api/v1/admin/metrics');
    const cuerpo = (await response.json()) as Record<string, number>;

    expect(cuerpo['usersTotal']).toBe(4);
    expect(Object.values(cuerpo).every((v) => typeof v === 'number')).toBe(true);
  });

  it('no las ve quien no es administrador', async () => {
    // Con `normal` no valdría: fue desactivado antes y su sesión se tiró, así
    // que daría 401 y el test pasaría sin comprobar el permiso.
    expect((await h.as(mirona).get('/api/v1/admin/metrics')).status).toBe(403);
  });
});

describe('auditoría de plataforma', () => {
  it('trae los eventos que no son de ningún workspace', async () => {
    const response = await h.as(jefa).get('/api/v1/admin/audit');
    const entradas = (await response.json()) as { action: string; actorHandle: string | null }[];

    expect(entradas.length).toBeGreaterThan(0);
    expect(entradas.map((e) => e.action)).toContain('user.role_changed');
  });

  it('no asoma nada de lo que pasa dentro de un workspace', async () => {
    // RF-703 frente a RF-704: ser administrador de la instancia no da acceso al
    // contenido ni a la actividad de los workspaces ajenos.
    const app = await h.as(otra).post(`/api/v1/workspaces/${otra.workspaceId}/apps`, {
      name: 'Algo privado',
    });
    expect(app.status).toBe(201);

    const response = await h.as(jefa).get('/api/v1/admin/audit');
    const crudo = JSON.stringify(await response.json());

    expect(crudo).not.toContain('app.created');
    expect(crudo).not.toContain('Algo privado');
  });

  it('filtra por persona', async () => {
    const response = await h.as(jefa).get(`/api/v1/admin/audit?actorId=${jefa.id}`);
    const entradas = (await response.json()) as { actorId: string }[];

    expect(entradas.length).toBeGreaterThan(0);
    expect(entradas.every((e) => e.actorId === jefa.id)).toBe(true);
  });

  it('no la ve quien no es administrador', async () => {
    expect((await h.as(mirona).get('/api/v1/admin/audit')).status).toBe(403);
  });
});

describe('actividad de un workspace', () => {
  it('la ve su dueño', async () => {
    // RF-704: lo que pasa dentro es asunto del dueño del workspace, no del
    // administrador de la instancia.
    await h.as(otra).post(`/api/v1/workspaces/${otra.workspaceId}/apps`, { name: 'Otra más' });

    const response = await h.as(otra).get(`/api/v1/workspaces/${otra.workspaceId}/audit`);
    const entradas = (await response.json()) as { action: string; actorHandle: string }[];

    expect(response.status).toBe(200);
    expect(entradas.map((e) => e.action)).toContain('app.created');
    expect(entradas[0]!.actorHandle).toBe('otra');
  });

  it('y nadie más, ni siquiera un administrador de la instancia', async () => {
    // Es la línea que separa administrar la instancia de leer los workspaces
    // ajenos (D-6). El administrador no es miembro de este.
    const response = await h.as(jefa).get(`/api/v1/workspaces/${otra.workspaceId}/audit`);
    expect(response.status).toBe(403);
  });

  it('no lleva nada de lo que se escribió', async () => {
    // RF-706: registra qué pasó, no qué decía.
    const response = await h.as(otra).get(`/api/v1/workspaces/${otra.workspaceId}/audit`);
    const crudo = JSON.stringify(await response.json());

    expect(crudo).not.toContain('# ');
    expect(crudo).not.toContain('token');
  });
});

describe('lo que queda registrado del acceso', () => {
  it('entrar y darse de alta dejan rastro (RF-701)', async () => {
    // Sin esto, la auditoría de plataforma estaba vacía: las acciones existían
    // como constantes pero no las escribía nadie.
    //
    // Se entra por el camino real y no sembrando filas: es justo lo que ocurre
    // al entrar lo que se está comprobando.
    await h.signIn('recien-llegada');

    const response = await h.as(jefa).get('/api/v1/admin/audit');
    const acciones = ((await response.json()) as { action: string }[]).map((e) => e.action);

    expect(acciones).toContain('user.created');
    expect(acciones).toContain('session.started');
  });

  it('la segunda vez ya no es un alta, pero sí una sesión', async () => {
    const antes = await h.as(jefa).get('/api/v1/admin/audit');
    const previas = (await antes.json()) as { action: string }[];
    const altasPrevias = previas.filter((e) => e.action === 'user.created').length;

    await h.signIn('recien-llegada');

    const response = await h.as(jefa).get('/api/v1/admin/audit');
    const entradas = (await response.json()) as { action: string }[];

    expect(entradas.filter((e) => e.action === 'user.created')).toHaveLength(altasPrevias);
    expect(entradas.filter((e) => e.action === 'session.started').length).toBeGreaterThan(
      previas.filter((e) => e.action === 'session.started').length,
    );
  });

  it('sin nada que identifique el dispositivo ni la conexión', async () => {
    // RF-706, RNF-112: registra qué pasó, no desde dónde.
    const response = await h.as(jefa).get('/api/v1/admin/audit');
    const crudo = JSON.stringify(await response.json());

    expect(crudo).not.toContain('Mozilla');
    expect(crudo).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});
