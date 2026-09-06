import type { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ProviderError, ProviderErrorKind } from '@app-foundry/core';
import { loadEnv } from '@app-foundry/env';

import { startAgentReplyWorker } from '../src/agent-reply.worker.js';
import { startWorkerHarness, type WorkerHarness } from './harness.js';

/**
 * Los cortafuegos del worker, ejecutados (RNF-902).
 *
 * Es la suite que exige el requisito: que un agente no reaccione a otro, que su
 * mención no invoque, y que el tope de turnos se respete. Se comprueban aquí y
 * no más arriba porque el worker es quien decide, y lo decide **al ejecutar**:
 * entre encolar y contestar puede haber pasado cualquier cosa.
 *
 * El modelo y los avisos se inyectan, que es para lo que están: lo que se
 * prueba es quién habla y cuándo, no qué contesta.
 */
let h: WorkerHarness;
let worker: Worker;

/** Lo que le pediríamos al modelo, y cuántas veces. */
let peticiones: { agentId: string; system: string; material: string }[] = [];
/** Los avisos emitidos, para comprobar que se avisa una vez y a quién. */
let avisos: unknown[] = [];
/** Si está puesto, la siguiente llamada al modelo falla así. */
let falloProgramado: { kind: ProviderErrorKind; veces: number } | null = null;
/** Lo que devuelve el modelo de mentira. Cambiarlo prueba qué se guarda. */
let respuesta = 'Scope looks wider than the problem.';
/** Y lo que se dijo a sí mismo, para el caso de quedarse sin sitio pensando. */
let razonamientoDevuelto = '';

/*
 * El entorno se compone con lo mínimo que el esquema exige. No se lee el `.env`
 * de la máquina a propósito: apuntaría a la base de datos de desarrollo y estas
 * pruebas escriben.
 */
const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://sin/usar',
  DATABASE_MIGRATION_URL: 'postgres://sin/usar',
  REDIS_URL: 'redis://sin/usar',
  GITHUB_CLIENT_ID: 'de-mentira',
  GITHUB_CLIENT_SECRET: 'de-mentira',
  SESSION_SECRET: 'x'.repeat(32),
});

/** Un aviso tal como lo recibe el emisor, con lo que este test mira de él. */
interface AvisoVisto {
  type: string;
  entorno: { destinatario?: string };
  payload: Record<string, unknown>;
}

const avisosDeFallo = (): AvisoVisto[] =>
  (avisos as AvisoVisto[]).filter((a) => a.type === 'AI_AGENT_FAILED');

/**
 * Espera al aviso de fallo.
 *
 * Se espera en vez de mirar de una: el aviso de un trabajo perdido se manda
 * desde el manejador de `failed`, que corre **después** de que la cola dé el
 * trabajo por acabado. Mirar justo al vaciarse la cola lo pillaría a medias.
 */
async function aQueLlegueElAvisoDeFallo(): Promise<AvisoVisto> {
  for (let intento = 0; intento < 50; intento += 1) {
    const [primero] = avisosDeFallo();
    if (primero) return primero;
    await new Promise((listo) => setTimeout(listo, 100));
  }
  throw new Error('no llegó ningún aviso de fallo');
}

/** Espera a que la cola se quede sin trabajo pendiente ni en curso. */
async function aQueTermine(): Promise<void> {
  for (let intento = 0; intento < 100; intento += 1) {
    const cuentas = await h.cola.getJobCounts('waiting', 'active', 'delayed');
    const pendientes =
      (cuentas['waiting'] ?? 0) + (cuentas['active'] ?? 0) + (cuentas['delayed'] ?? 0);
    if (pendientes === 0) return;
    await new Promise((listo) => setTimeout(listo, 100));
  }
  throw new Error('la cola no se vació');
}

beforeAll(async () => {
  h = await startWorkerHarness();

  worker = startAgentReplyWorker({
    redis: h.redis,
    db: h.db,
    env,
    log: new Logger('test'),
    ask: (peticion) => {
      peticiones.push({
        agentId: peticion.agentId,
        system: peticion.system,
        material: peticion.messages.map((m) => m.content).join('\n'),
      });

      if (falloProgramado && falloProgramado.veces > 0) {
        falloProgramado.veces -= 1;
        return Promise.reject(new ProviderError(falloProgramado.kind, 'de mentira'));
      }
      return Promise.resolve({
        texto: respuesta,
        razonamiento: razonamientoDevuelto,
        provider: 'ANTHROPIC',
        modelId: 'fake-large',
      });
    },
    notify: (aviso) => {
      avisos.push(aviso);
      return Promise.resolve([]);
    },
  });
}, 300_000);

afterEach(() => {
  peticiones = [];
  avisos = [];
  falloProgramado = null;
  respuesta = 'Scope looks wider than the problem.';
  razonamientoDevuelto = '';
});

afterAll(async () => {
  await worker.close();
  await h.stop();
});

describe('un agente contesta a quien le habla', () => {
  it('escribe una vez, colgando del comentario que lo provocó', async () => {
    const provocador = await h.comentar('@po ¿esto se sostiene?');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(1);
    expect(await h.loEscritoPorElAgente()).toEqual(['Scope looks wider than the problem.']);
    expect(avisos).toHaveLength(1);
  });

  it('y el perfil viaja aparte del material, que va etiquetado como datos', async () => {
    const provocador = await h.comentar('@po otra vez');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones[0]!.system).toContain('Ask what problem this solves.');
    expect(peticiones[0]!.system).toContain('DATA');
    /* Y el hilo va en el otro lado, nunca en el papel (RF-1614). */
    expect(peticiones[0]!.system).not.toContain('¿esto se sostiene?');
    expect(peticiones[0]!.material).toContain('<thread>');
  });
});

describe('el cortafuegos: un agente no reacciona a otro', () => {
  it('un trabajo cuyo disparador escribió un agente no llega al modelo', async () => {
    /*
     * Se encola a mano contra un comentario del propio agente, que es lo que no
     * puede ocurrir por el camino normal: la condición de entrada es que lo
     * haya escrito una persona (T-35). Se comprueba aquí porque es la
     * comprobación que sigue en pie si algún día se encola desde otro sitio.
     */
    const [suyo] = (
      await h.db.execute<{ id: string }>(
        sql`SELECT id FROM comments
            WHERE thread_id = ${h.escenario.threadId}::uuid AND author_agent_id IS NOT NULL
            ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows;

    await h.encolar({ triggerCommentId: suyo!.id });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);
  });
});

describe('el cortafuegos: el tope de turnos por hilo', () => {
  it('al alcanzarlo, una réplica ya no le hace hablar', async () => {
    /* Ya ha escrito dos veces; la tercera agota el tope de tres. */
    const tercero = await h.comentar('Sigo hablando.');
    await h.encolar({ triggerCommentId: tercero, trigger: 'REPLY' });
    await aQueTermine();
    expect(peticiones).toHaveLength(1);

    peticiones = [];
    const cuarto = await h.comentar('Y una vez más.');
    await h.encolar({ triggerCommentId: cuarto, trigger: 'REPLY' });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);
  });

  it('pero una mención explícita le devuelve la palabra', async () => {
    /*
     * El tope existe para que un hilo no se llene solo, no para dejar mudo a
     * quien alguien está llamando a propósito (RF-1605).
     */
    const llamada = await h.comentar('@po te llamo aunque hayas hablado mucho');
    await h.encolar({ triggerCommentId: llamada, trigger: 'MENTION' });
    await aQueTermine();

    expect(peticiones).toHaveLength(1);
  });
});

describe('un agente que ya no interviene', () => {
  it('desactivado, no contesta aunque el trabajo estuviera encolado', async () => {
    await h.db.execute(
      sql`UPDATE agents SET active = false WHERE id = ${h.escenario.agentId}::uuid`,
    );

    const provocador = await h.comentar('@po ¿sigues?');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);

    await h.db.execute(
      sql`UPDATE agents SET active = true WHERE id = ${h.escenario.agentId}::uuid`,
    );
  });
});

describe('un reintento no duplica el comentario', () => {
  it('el mismo disparador no se contesta dos veces', async () => {
    const provocador = await h.comentar('@po una sola respuesta');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();
    const trasElPrimero = (await h.loEscritoPorElAgente()).length;

    /* Como si el trabajo se hubiera reencolado tras una caída. */
    peticiones = [];
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(0);
    expect((await h.loEscritoPorElAgente()).length).toBe(trasElPrimero);
  });
});

describe('qué se reintenta y qué no', () => {
  it('un fallo pasajero se reintenta y acaba contestando', async () => {
    falloProgramado = { kind: ProviderErrorKind.TRANSIENT, veces: 1 };

    const provocador = await h.comentar('@po con un tropiezo');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    /* Dos llamadas: la que falló y la que salió (RNF-703). */
    expect(peticiones.length).toBeGreaterThanOrEqual(2);
    expect(await h.loEscritoPorElAgente()).toContain('Scope looks wider than the problem.');
  });

  it('una credencial revocada no se reintenta: insistir solo acumula fallos', async () => {
    falloProgramado = { kind: ProviderErrorKind.AUTH, veces: 99 };

    const provocador = await h.comentar('@po con la clave mal');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones).toHaveLength(1);

    /*
     * Y quien preguntó se entera (RF-1615). Sin esto, un proveedor con la
     * credencial revocada se traduce en un hilo donde no pasa nada: desde
     * fuera es idéntico a que el agente esté pensándoselo.
     */
    const aviso = await aQueLlegueElAvisoDeFallo();
    expect(aviso.entorno.destinatario).toBe(h.escenario.anaId);
    expect(String(aviso.payload['message'])).toContain('credential');
    expect(aviso.payload['actorHandle']).toBe('po');
  });

  it('y un tropiezo pasajero que acaba bien no avisa de nada', async () => {
    /*
     * El aviso es del silencio definitivo, no de cada intento: contarle a
     * alguien un fallo que se arregló solo dos segundos después es ruido que
     * enseña a ignorar la campana.
     */
    falloProgramado = { kind: ProviderErrorKind.TRANSIENT, veces: 1 };

    const provocador = await h.comentar('@po con otro tropiezo');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();
    await new Promise((listo) => setTimeout(listo, 300));

    expect(avisosDeFallo()).toHaveLength(0);
  });
});

describe('cuando el modelo se queda sin sitio pensando', () => {
  it('lo dice en el hilo en vez de callarse, y conserva lo pensado', async () => {
    /*
     * Pasó de verdad: `qwen3.6` se gastó el presupuesto entero deliberando y no
     * llegó a contestar. Callar dejaba a quien preguntó mirando un hilo donde no
     * pasaba nada, sin distinguir «se lo está pensando» de «se ha roto algo».
     */
    respuesta = '';
    razonamientoDevuelto = 'Estaba dándole vueltas y me quedé sin sitio';

    const provocador = await h.comentar('@po una pregunta que da que pensar');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    const escrito = await h.loEscritoPorElAgente();
    expect(escrito[escrito.length - 1]).toContain('ran out of room while thinking');
  });

  it('pero sin respuesta y sin razonamiento no escribe nada, y lo avisa', async () => {
    /*
     * Ahí no hay nada que contar en el hilo, y un comentario vacío es peor que
     * ninguno. Lo que no puede ser es que además no lo sepa nadie: quien
     * preguntó se queda esperando una respuesta que no va a llegar (RF-1615).
     */
    respuesta = '';
    razonamientoDevuelto = '';

    const antes = (await h.loEscritoPorElAgente()).length;
    const provocador = await h.comentar('@po otra más');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect((await h.loEscritoPorElAgente()).length).toBe(antes);

    const aviso = await aQueLlegueElAvisoDeFallo();
    expect(String(aviso.payload['message'])).toContain('came back empty');
  });
});

describe('el límite de palabras de la respuesta', () => {
  /*
   * Al final del fichero a propósito: contestar consume un turno del hilo, y
   * el tope de turnos se comprueba más arriba contando los que lleva. Un test
   * que habla en medio le cambia la cuenta al de al lado.
   */
  it('si su configuración pide brevedad, se le pide en el papel', async () => {
    /*
     * El límite se le dice al modelo y no se recorta después (RF-1516): cortar
     * el texto daría una respuesta mutilada a mitad de frase, y pedirlo antes
     * da una corta. De fábrica es cero, y entonces no se le dice nada.
     */
    await h.db.execute(
      sql`UPDATE agents SET reply_word_limit = 60 WHERE id = ${h.escenario.agentId}::uuid`,
    );

    const provocador = await h.comentar('@po y esta vez corto');
    await h.encolar({ triggerCommentId: provocador });
    await aQueTermine();

    expect(peticiones[0]!.system).toContain('must fit in 60 words');
  });
});

describe('un hilo sobre un fragmento del documento', () => {
  /**
   * Un hilo inline propio, con su cita y su estado de ancla.
   *
   * Se siembra a mano porque el escenario del arnés tiene un hilo general, que
   * es el caso normal, y aquí lo que se prueba es justo el otro.
   */
  async function hiloInline(
    cita: string,
    estado: 'ANCHORED' | 'ORPHANED',
  ): Promise<{ threadId: string; disparador: string }> {
    /* Un hilo inline pertenece a una versión, y el motor lo exige (RF-817). */
    const [version] = (
      await h.db.execute<{ id: string }>(
        sql`INSERT INTO document_versions (document_id, version_no, content, author_id, message)
            SELECT d.id, coalesce(max(v.version_no), 0) + 1, ${'# Idea\n\n' + 'Un documento.'},
                   ${h.escenario.anaId}::uuid, 'Primera'
            FROM documents d LEFT JOIN document_versions v ON v.document_id = d.id
            WHERE d.app_id = ${h.escenario.appId}::uuid
            GROUP BY d.id
            RETURNING id`,
      )
    ).rows;

    const [hilo] = (
      await h.db.execute<{ id: string }>(
        sql`INSERT INTO comment_threads
              (app_id, document_id, kind, anchor_quote, anchor_status,
               anchored_version_id, created_by)
            VALUES (
              ${h.escenario.appId}::uuid,
              (SELECT id FROM documents WHERE app_id = ${h.escenario.appId}::uuid LIMIT 1),
              'INLINE', ${cita}, ${estado}, ${version!.id}::uuid, ${h.escenario.anaId}::uuid)
            RETURNING id`,
      )
    ).rows;

    const [comentario] = (
      await h.db.execute<{ id: string }>(
        sql`INSERT INTO comments (thread_id, body, author_id)
            VALUES (${hilo!.id}::uuid, '@po ¿esto se sostiene?', ${h.escenario.anaId}::uuid)
            RETURNING id`,
      )
    ).rows;

    return { threadId: hilo!.id, disparador: comentario!.id };
  }

  it('le llega la cita, y sabe que la conversación va de ahí', async () => {
    /*
     * Sin ella, «¿esto se sostiene?» llega sin sujeto: el agente recibe el
     * documento entero y una pregunta que señala a un trozo que no viene
     * (RF-1616).
     */
    const { threadId, disparador } = await hiloInline(
      'Los datos abiertos dan posiciones cada treinta segundos',
      'ANCHORED',
    );

    await h.encolar({ threadId, triggerCommentId: disparador });
    await aQueTermine();

    expect(peticiones[0]!.material).toContain('Los datos abiertos dan posiciones');
    expect(peticiones[0]!.material).toContain('<quoted-from-document>');
  });

  it('pero no si el ancla se quedó huérfana', async () => {
    /*
     * El hilo conserva la cita para que se entienda de qué se hablaba, pero ese
     * texto ya no está en el documento (RF-809). Dárselo sería pedirle que
     * opine sobre algo que nadie puede ir a mirar.
     */
    const { threadId, disparador } = await hiloInline('Un párrafo que ya no está', 'ORPHANED');

    await h.encolar({ threadId, triggerCommentId: disparador });
    await aQueTermine();

    expect(peticiones[0]!.material).not.toContain('Un párrafo que ya no está');
    expect(peticiones[0]!.material).not.toContain('quoted-from-document');
  });
});
