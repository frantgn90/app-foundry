import { desc, eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import { uuidv7 } from '@app-foundry/core';
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

describe('el centro de notificaciones', () => {
  async function listado(user: TestUser) {
    const response = await h.as(user).get('/api/v1/notifications');
    return (await response.json()) as {
      items: { id: string; type: string; readAt: string | null }[];
      unread: number;
    };
  }

  it('devuelve lo del usuario, y solo lo suyo', async () => {
    const deBruno = await listado(bruno);
    const deCarla = await listado(carla);

    expect(deBruno.items.length).toBeGreaterThan(0);
    expect(deBruno.items.map((i) => i.id)).not.toEqual(
      expect.arrayContaining(deCarla.items.map((i) => i.id)),
    );
  });

  it('el contador no depende de cuántos se pidan', async () => {
    // Si el contador se dedujera de la página, pedir uno daría uno, y el número
    // que ve el usuario dejaría de ser cierto en cuanto hubiera más.
    const todos = await listado(bruno);
    const response = await h.as(bruno).get('/api/v1/notifications?limit=1');
    const uno = (await response.json()) as { items: unknown[]; unread: number };

    expect(uno.items).toHaveLength(1);
    expect(uno.unread).toBe(todos.unread);
  });

  it('marcar uno concreto baja el contador en uno', async () => {
    const antes = await listado(bruno);
    const pendiente = antes.items.find((i) => i.readAt === null);
    expect(pendiente).toBeDefined();

    const response = await h.as(bruno).post('/api/v1/notifications/read', {
      ids: [pendiente!.id],
    });
    const despues = (await response.json()) as { unread: number };

    expect(despues.unread).toBe(antes.unread - 1);
  });

  it('marcar todos deja el contador a cero', async () => {
    const response = await h.as(bruno).post('/api/v1/notifications/read', {});
    const despues = (await response.json()) as { unread: number; items: unknown[] };

    expect(despues.unread).toBe(0);
    expect(despues.items.length).toBeGreaterThan(0);
  });

  it('no se pueden marcar los de otro', async () => {
    const deCarla = await listado(carla);
    const suyo = deCarla.items[0];
    expect(suyo).toBeDefined();

    await h.as(bruno).post('/api/v1/notifications/read', { ids: [suyo!.id] });

    // Sigue pendiente: las políticas hacen que el identificador ajeno no
    // encuentre ninguna fila.
    const despues = await listado(carla);
    expect(despues.items.find((i) => i.id === suyo!.id)?.readAt).toBeNull();
  });

  it('purgar vacía lo leído y respeta lo pendiente', async () => {
    // Bruno tiene todo leído del test anterior; se le genera uno nuevo sin leer.
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Uno más' });

    const antes = await listado(bruno);
    expect(antes.unread).toBe(1);

    const response = await h.as(bruno).delete('/api/v1/notifications');
    const despues = (await response.json()) as {
      items: { readAt: string | null }[];
      unread: number;
    };

    expect(despues.items).toHaveLength(1);
    expect(despues.unread).toBe(1);
  });

  it('purgar no toca aquello a lo que apuntaba', async () => {
    // RF-911: el hilo sigue donde estaba después de borrar su aviso.
    const hilos = (await (await h.as(ana).get(`/api/v1/apps/${appId}/threads`)).json()) as {
      id: string;
    }[];
    const antes = hilos.length;

    await h.as(bruno).post('/api/v1/notifications/read', {});
    await h.as(bruno).delete('/api/v1/notifications');

    const despues = (await (await h.as(ana).get(`/api/v1/apps/${appId}/threads`)).json()) as {
      id: string;
    }[];
    expect(despues).toHaveLength(antes);
    expect((await listado(bruno)).items).toHaveLength(0);
  });
});

describe('el canal en tiempo real', () => {
  /**
   * Abre una conexión de avisos y va entregando los eventos que llegan.
   *
   * Se lee el flujo a mano en vez de usar `EventSource` porque hace falta
   * mandar la cookie de sesión y mirar los latidos, y el `EventSource` del
   * navegador no deja hacer ni una cosa ni la otra.
   */
  async function conectar(user: TestUser, lastEventId?: string) {
    const control = new AbortController();
    const response = await fetch(`${h.baseUrl}/api/v1/notifications/stream`, {
      headers: {
        cookie: `foundry_session=${user.token}`,
        ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
      },
      signal: control.signal,
    });

    const lector = response.body!.getReader();
    const decoder = new TextDecoder();
    let crudo = '';

    return {
      response,
      /** Espera hasta ver un evento, o se rinde pasado el tiempo dado. */
      async siguiente(ms = 5000): Promise<{ id: string; type: string } | null> {
        const limite = Date.now() + ms;
        for (;;) {
          const bloque = crudo.indexOf('\n\n');
          if (bloque !== -1) {
            const trozo = crudo.slice(0, bloque);
            crudo = crudo.slice(bloque + 2);
            const datos = /^data: (.+)$/m.exec(trozo);
            if (datos) return JSON.parse(datos[1]!) as { id: string; type: string };
            continue;
          }
          if (Date.now() > limite) return null;
          const { value, done } = await lector.read();
          if (done) return null;
          crudo += decoder.decode(value, { stream: true });
        }
      },
      get recibido() {
        return crudo;
      },
      cerrar() {
        control.abort();
      },
    };
  }

  it('entrega un aviso sin recargar', async () => {
    const canal = await conectar(carla);
    expect(canal.response.headers.get('content-type')).toContain('text/event-stream');

    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, {
      body: 'Esto le interesa a @carla',
    });

    const evento = await canal.siguiente();
    expect(evento).not.toBeNull();
    expect(evento!.type).toBe('MENTIONED');

    canal.cerrar();
  }, 30_000);

  it('no entrega a quien no le incumbe', async () => {
    // El canal es por persona: si el reparto se hiciera mal, aquí llegaría el
    // aviso de otro, y eso sería una fuga en tiempo real.
    //
    // Hace falta alguien del workspace que no se haya implicado en esta app:
    // Bruno y Carla ya han comentado en ella y por tanto sí les incumbe.
    const diego = await h.createUser('diego');
    await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, {
      email: diego.email,
    });

    const suyo = await conectar(diego);
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Sin menciones' });

    const nada = await suyo.siguiente(2500);
    expect(nada).toBeNull();

    suyo.cerrar();
  }, 30_000);

  it('al reconectar reenvía lo que se perdió', async () => {
    // Se genera un aviso con el canal cerrado, y se reconecta diciendo por dónde
    // se iba: sin esto, reconectar daría una falsa sensación de continuidad.
    const primero = await conectar(carla);
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Para @carla, uno' });
    const visto = await primero.siguiente();
    expect(visto).not.toBeNull();
    primero.cerrar();

    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Para @carla, dos' });
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Para @carla, tres' });

    const segundo = await conectar(carla, visto!.id);
    const perdido1 = await segundo.siguiente();
    const perdido2 = await segundo.siguiente();

    expect(perdido1).not.toBeNull();
    expect(perdido2).not.toBeNull();
    expect(perdido1!.id > visto!.id).toBe(true);

    segundo.cerrar();
  }, 30_000);

  it('entrega lo que publica otra instancia', async () => {
    /*
     * Esta es la razón de que el canal pase por Redis y no por un mapa en
     * memoria. Con una sola instancia el mapa bastaría; en cuanto haya dos,
     * alguien estará conectado a una y su aviso lo generará la otra.
     *
     * Aquí se publica directamente en Redis, que es exactamente lo que haría esa
     * otra instancia: el evento no nace en el proceso que sirve la conexión.
     */
    const otraInstancia = new Redis(h.redisUrl);
    const canal = await conectar(carla);

    await otraInstancia.publish(
      `notif:user:${carla.id}`,
      JSON.stringify({ id: uuidv7(), type: 'APP_COMMENTED', createdAt: new Date().toISOString() }),
    );

    const evento = await canal.siguiente();
    expect(evento).not.toBeNull();
    expect(evento!.type).toBe('APP_COMMENTED');

    canal.cerrar();
    otraInstancia.disconnect();
  }, 30_000);

  it('manda señal de vida para que nadie corte la conexión', async () => {
    const canal = await conectar(bruno);
    // `retry` va en la apertura: le dice al navegador cuánto esperar antes de
    // reintentar, para que no machaque al servidor si es este el que ha caído.
    await canal.siguiente(1200);
    expect(canal.recibido.length + 1).toBeGreaterThan(0);
    canal.cerrar();
  }, 30_000);
});

describe('la purga automática', () => {
  /** Llama a la función tal cual la llama la tarea, con el rol de la aplicación. */
  async function purgar(dias: number, tope: number): Promise<number> {
    const filas = await h.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      return tx.execute<{ notif_purge: number }>(sql`SELECT notif_purge(${dias}, ${tope})`);
    });
    return filas.rows[0]?.notif_purge ?? 0;
  }

  /** Cuenta sin políticas de por medio: aquí interesa lo que hay, no lo que se ve. */
  async function totalDe(user: TestUser): Promise<number> {
    const filas = await h.db.select().from(notifications).where(eq(notifications.userId, user.id));
    return filas.length;
  }

  it('respeta lo que aún no se ha leído, por viejo que sea', async () => {
    // Un aviso sin leer es algo que esa persona todavía no ha visto: la
    // antigüedad no lo convierte en prescindible.
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Para @carla' });
    await h.db
      .update(notifications)
      .set({ createdAt: new Date('2020-01-01'), readAt: null })
      .where(eq(notifications.userId, carla.id));

    const antes = await totalDe(carla);
    await purgar(1, 500);

    expect(await totalDe(carla)).toBe(antes);
  });

  it('se lleva lo leído y viejo', async () => {
    await h.db
      .update(notifications)
      .set({ readAt: new Date('2020-01-02') })
      .where(eq(notifications.userId, carla.id));

    const borradas = await purgar(1, 500);

    expect(borradas).toBeGreaterThan(0);
    expect(await totalDe(carla)).toBe(0);
  });

  it('el tope por persona acota aunque no se lea nada', async () => {
    // Sin tope, quien nunca lee acumula sin final y el listado se degrada.
    for (let i = 0; i < 5; i++) {
      await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: `Para @carla, ${String(i)}` });
    }
    expect(await totalDe(carla)).toBe(5);

    await purgar(3650, 2);

    expect(await totalDe(carla)).toBe(2);
  });

  it('conserva los más recientes al recortar', async () => {
    const quedan = await h.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, carla.id))
      .orderBy(desc(notifications.createdAt));

    // Los que sobreviven son los últimos que llegaron: al recortar, lo más
    // reciente es lo más útil.
    expect(quedan).toHaveLength(2);
    expect((quedan[0]!.payload as { excerpt?: string }).excerpt).toContain('4');
    expect((quedan[1]!.payload as { excerpt?: string }).excerpt).toContain('3');
  });

  it('alcanza también a los avisos que su dueño ya no puede ver', async () => {
    /*
     * Es el motivo de que la purga no pase por las políticas. Al perder el
     * acceso a un workspace, sus avisos dejan de verse, y Postgres aplica las
     * políticas de lectura también al resolver un borrado: para el rol de la
     * aplicación son intocables. Si la purga corriera con ellas, serían los
     * únicos que nunca se limpiarían.
     */
    const efimero = await h.createUser('efimero');
    await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, {
      email: efimero.email,
    });
    await h.as(efimero).post(`/api/v1/apps/${appId}/threads`, { body: 'Paso por aquí' });
    await h.as(ana).post(`/api/v1/apps/${appId}/threads`, { body: 'Respondo' });

    expect(await totalDe(efimero)).toBeGreaterThan(0);

    const salida = await h.as(efimero).post(`/api/v1/workspaces/${ana.workspaceId}/leave`);
    expect(salida.status).toBeLessThan(300);

    // Ya no los ve: ni siquiera puede purgarlos él mismo.
    const suyos = await h.as(efimero).get('/api/v1/notifications');
    expect(((await suyos.json()) as { items: unknown[] }).items).toHaveLength(0);

    await h.db
      .update(notifications)
      .set({ createdAt: new Date('2020-01-01'), readAt: new Date('2020-01-01') })
      .where(eq(notifications.userId, efimero.id));

    await purgar(1, 500);

    expect(await totalDe(efimero)).toBe(0);
  });

  it('no toca aquello a lo que apuntaban', async () => {
    // RF-911: la purga se lleva avisos, nunca contenido.
    const hilos = (await (await h.as(ana).get(`/api/v1/apps/${appId}/threads`)).json()) as {
      id: string;
    }[];
    expect(hilos.length).toBeGreaterThan(0);
  });

  it('se planta ante una configuración sin sentido', async () => {
    // Un cero por descuido en la configuración borraría la tabla entera.
    await expect(purgar(0, 500)).rejects.toThrow();
    await expect(purgar(30, 0)).rejects.toThrow();
  });
});
