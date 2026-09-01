import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeProvider, type ProviderRegistry } from '@app-foundry/ai';
import { AiProvider } from '@app-foundry/core';
import { aiInvocations } from '@app-foundry/db';

import { AI_REGISTRY } from '../src/ai/ai.tokens.js';
import { AiCircuitService } from '../src/ai/circuit.service.js';
import { type Harness, startHarness, type TestUser } from './harness.js';

/**
 * El asistente de escritura, de la petición al registro (RF-1401..1411).
 *
 * Se ejercita la ruta de verdad contra el proveedor de mentira, que es lo que
 * permite provocar a voluntad lo que no se puede provocar con uno real: un fallo
 * pasajero, una cadena de fallos, o una generación lenta a la que dar tiempo a
 * cancelarse.
 */
let h: Harness;
let ana: TestUser;
let bruno: TestUser;
let appId: string;
let proveedor: FakeProvider;
let cortacircuitos: AiCircuitService;

interface Evento {
  type: string;
  [campo: string]: unknown;
}

interface Respuesta {
  status: number;
  eventos: Evento[];
  cuerpo: string;
}

/**
 * Un documento que no cabe en la ventana de `fake-tiny`: cuatro caracteres por
 * token, así que siete mil caracteres son mil setecientos y pico tokens.
 *
 * Se encoge el modelo en lugar de agrandar el documento porque uno que no
 * quepa en doscientos mil tokens ocuparía casi un mega, y el servidor —con
 * razón— no acepta cuerpos así.
 */
const ENORME = `# Enorme\n\n${'palabra '.repeat(900)}`;

async function documento(): Promise<{ content: string; revision: number }> {
  const response = await h.as(ana).get(`/api/v1/apps/${appId}/document`);
  return (await response.json()) as { content: string; revision: number };
}

async function escribir(content: string): Promise<void> {
  const { revision } = await documento();
  await h.as(ana).put(`/api/v1/apps/${appId}/document`, { content, revision });
}

async function pedir(quien: TestUser, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const response = await h.as(quien).post(`/api/v1/apps/${appId}/document/assist`, cuerpo);
  const texto = await response.text();
  return { status: response.status, eventos: partir(texto), cuerpo: texto };
}

/** Los eventos de un flujo SSE, ya en objetos. */
function partir(cuerpo: string): Evento[] {
  return cuerpo
    .split('\n\n')
    .map((bloque) => /^data: (.*)$/m.exec(bloque)?.[1])
    .filter((datos): datos is string => datos !== undefined)
    .map((datos) => JSON.parse(datos) as Evento);
}

const textoDe = (eventos: Evento[]): string =>
  eventos
    .filter((evento) => evento.type === 'delta')
    .map((evento) => evento['text'] as string)
    .join('');

const meta = (eventos: Evento[]): Evento | undefined =>
  eventos.find((evento) => evento.type === 'meta');

/** La última invocación registrada, que es donde se ve el desenlace de verdad. */
async function ultimaInvocacion() {
  const [fila] = await h.db
    .select()
    .from(aiInvocations)
    .where(eq(aiInvocations.workspaceId, ana.workspaceId))
    .orderBy(desc(aiInvocations.id))
    .limit(1);
  return fila;
}

/**
 * Una selección cualquiera del primer párrafo.
 *
 * Se calcula sobre el documento que haya en ese momento, y no buscando una
 * palabra concreta: los tests de más abajo lo reescriben, y una selección atada
 * a un texto que ya no está produce un 400 de validación que se confundiría con
 * el rechazo que sí se quiere comprobar.
 */
const seleccion = async (extra: Record<string, unknown> = {}) => {
  const doc = await documento();
  const start = doc.content.indexOf('\n\n') + 2;
  return {
    action: 'IMPROVE',
    scope: 'SELECTION',
    start,
    end: Math.min(doc.content.length, start + 60),
    revision: doc.revision,
    ...extra,
  };
};

beforeAll(async () => {
  h = await startHarness();
  ana = await h.createUser('ana');
  bruno = await h.createUser('bruno');
  cortacircuitos = h.resolve(AiCircuitService);

  const registro = h.resolve<ProviderRegistry>(AI_REGISTRY);
  proveedor = registro.get(AiProvider.ANTHROPIC) as FakeProvider;

  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/invitations`, { email: bruno.email });
  await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/ai/consent`);
  await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
    apiKey: 'sk-de-mentira-pero-larga',
  });

  const app = await h.as(ana).post(`/api/v1/workspaces/${ana.workspaceId}/apps`, {
    name: 'Asistida',
    accessLevel: 'WORKSPACE_WRITE',
  });
  appId = ((await app.json()) as { id: string }).id;
}, 240_000);

afterAll(async () => {
  await h.stop();
});

describe('una propuesta sobre lo marcado', () => {
  it('llega por partes, y lo que llega es lo que dijo el modelo', async () => {
    proveedor.program({ text: 'un parrafo mucho mejor escrito' });

    const { status, eventos } = await pedir(ana, await seleccion());

    expect(status).toBe(200);
    expect(textoDe(eventos)).toBe('un parrafo mucho mejor escrito');
    /*
     * En partes de verdad: si llegara de una vez, quien lo lee no podría
     * descartarlo sin esperar al final, que es justo lo que pide RF-1407.
     */
    expect(eventos.filter((evento) => evento.type === 'delta').length).toBeGreaterThan(1);
    expect(eventos.at(-1)?.type).toBe('done');
  });

  it('no toca el documento: es una propuesta, no un guardado', async () => {
    const antes = await documento();
    await pedir(ana, await seleccion());

    expect(await documento()).toEqual(antes);
  });

  it('queda registrada con su tarea y su desenlace', async () => {
    await pedir(ana, await seleccion());
    const fila = await ultimaInvocacion();

    expect(fila?.task).toBe('TEXT_ASSIST');
    expect(fila?.outcome).toBe('COMPLETED');
    expect(fila?.appId).toBe(appId);
    expect(fila?.outputTokens).toBeGreaterThan(0);
  });

  it('las cinco acciones valen, y ninguna más', async () => {
    for (const action of ['IMPROVE', 'TIGHTEN', 'SUMMARISE', 'EXPAND', 'PROOFREAD']) {
      expect((await pedir(ana, await seleccion({ action }))).status).toBe(200);
    }
    /* Sin instrucción libre (RF-1402): lo que no está en la lista no entra. */
    expect((await pedir(ana, await seleccion({ action: 'TRANSLATE' }))).status).toBe(400);
  });
});

describe('el contexto que se envía', () => {
  /*
   * Con la ventana de un modelo de verdad no hay documento que no quepa sin
   * pasarse del tamaño máximo de una petición. Así que el que se hace pequeño es
   * el modelo: se cambia el catálogo del proveedor y se le asigna la tarea, que
   * es exactamente lo que haría el dueño desde su pantalla.
   */
  beforeAll(async () => {
    proveedor.program({
      models: [
        { id: 'fake-tiny', displayName: 'Fake Tiny', contextWindow: 2_000, maxOutputTokens: 400 },
      ],
    });
    await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/providers/ANTHROPIC`, {
      apiKey: 'sk-de-mentira-pero-larga',
    });
    await h.as(ana).put(`/api/v1/workspaces/${ana.workspaceId}/ai/tasks/TEXT_ASSIST`, {
      provider: 'ANTHROPIC',
      modelId: 'fake-tiny',
    });
  });

  /*
   * Con el documento entero, el modelo sabe de qué va lo que reescribe. Sin él,
   * reescribe una frase a ciegas. Por eso se intenta primero.
   */
  it('cabiendo, va el documento entero y no se dice nada de recorte', async () => {
    const { eventos } = await pedir(ana, await seleccion());

    expect(meta(eventos)?.['variant']).toBe('documento');
    expect(meta(eventos)?.['contextTrimmed']).toBe(false);
  });

  /*
   * Y cuando no cabe, se manda el entorno **y se dice** (RF-1409). Lo que no se
   * hace nunca es recortar en silencio: entonces el modelo responde, la
   * respuesta parece razonable y nadie sabe que opinó sobre la mitad.
   */
  it('sin caber, va solo el entorno, y se dice', async () => {
    await escribir(ENORME);
    const doc = await documento();

    const { status, eventos } = await pedir(ana, {
      action: 'IMPROVE',
      scope: 'SELECTION',
      start: 10,
      end: 80,
      revision: doc.revision,
    });

    expect(status).toBe(200);
    expect(meta(eventos)?.['variant']).toBe('entorno');
    expect(meta(eventos)?.['contextTrimmed']).toBe(true);
  });

  /*
   * Sobre el documento entero no hay entorno al que recurrir: el documento **es**
   * el texto. Se rechaza antes de invocar, diciendo cuánto sobra (RF-1106).
   */
  it('sobre el documento entero, si no cabe se rechaza con el motivo', async () => {
    const doc = await documento();

    const { status, cuerpo } = await pedir(ana, {
      action: 'SUMMARISE',
      scope: 'DOCUMENT',
      revision: doc.revision,
    });

    expect(status).toBe(400);
    /*
     * Con el número aparte, no solo dentro de la frase: el texto lo escribe el
     * servidor en español y la interfaz está en inglés, así que allí se redacta
     * de nuevo y lo único que no puede inventarse es cuánto sobra.
     */
    const detalle = JSON.parse(cuerpo) as { reason: string; overflowTokens: number };
    expect(detalle.reason).toBe('CONTEXT_OVERFLOW');
    expect(detalle.overflowTokens).toBeGreaterThan(0);
  });

  it('vuelta a un documento normal, el entero sí cabe', async () => {
    await escribir('# The problem\n\nAlgo corto y llevadero.');
    const doc = await documento();

    const { status, eventos } = await pedir(ana, {
      action: 'SUMMARISE',
      scope: 'DOCUMENT',
      revision: doc.revision,
    });

    expect(status).toBe(200);
    expect(meta(eventos)?.['variant']).toBe('documento');
  });
});

describe('el techo, antes de pedirlo', () => {
  /*
   * Sobre el documento entero es la operación interactiva más cara del producto,
   * y conviene que no sea una sorpresa (RF-1412). Se enseña antes de empezar y
   * es un **techo**: entrada contada más salida al máximo, no una media que
   * luego se pase.
   */
  it('dice cuánto como mucho, sin invocar a nadie', async () => {
    proveedor.program({ text: 'da igual: no debería llegar a pedirse' });
    const doc = await documento();
    const response = await h.as(ana).post(`/api/v1/apps/${appId}/document/assist/estimate`, {
      action: 'SUMMARISE',
      scope: 'DOCUMENT',
      revision: doc.revision,
    });
    const techo = (await response.json()) as {
      estimatedTokens: number;
      maxOutputTokens: number;
      variant: string;
    };

    expect(response.status).toBe(201);
    expect(techo.estimatedTokens).toBeGreaterThan(techo.maxOutputTokens);
    expect(techo.variant).toBe('documento');
    /* Ni una llamada de generación: contar sí, invocar no. */
    expect(proveedor.calls.some((llamada) => llamada.operation === 'streamText')).toBe(false);
  });

  it('lo que aquí se rechaza también se habría rechazado al pedirlo', async () => {
    const doc = await documento();
    const response = await h.as(ana).post(`/api/v1/apps/${appId}/document/assist/estimate`, {
      action: 'IMPROVE',
      scope: 'SELECTION',
      start: 0,
      end: doc.content.length + 50,
      revision: doc.revision,
    });

    expect(response.status).toBe(400);
  });
});

describe('quién puede pedirlo, y sobre qué', () => {
  /*
   * Con solo lectura no aparece en la interfaz (RF-1406), pero eso es una
   * cortesía: quien lo pida a mano tiene que encontrarse un no.
   */
  it('sin permiso de edición, no', async () => {
    await h.as(ana).patch(`/api/v1/apps/${appId}/access-level`, { accessLevel: 'WORKSPACE_READ' });

    const doc = await documento();
    const { status } = await pedir(bruno, {
      action: 'IMPROVE',
      scope: 'DOCUMENT',
      revision: doc.revision,
    });

    expect(status).toBe(403);

    await h.as(ana).patch(`/api/v1/apps/${appId}/access-level`, { accessLevel: 'WORKSPACE_WRITE' });
  });

  /*
   * Las posiciones solo significan algo contra el texto del que salieron. Si
   * alguien guardó mientras tanto, apuntan a otra cosa, y reescribir «lo
   * marcado» sería reescribir otro fragmento (RF-1408).
   */
  it('con una revisión que ya no es, se rechaza en vez de acertar por suerte', async () => {
    const { status } = await pedir(ana, await seleccion({ revision: 999 }));

    expect(status).toBe(409);
  });

  it('una selección fuera del documento no se atiende', async () => {
    const doc = await documento();
    const { status } = await pedir(ana, {
      action: 'IMPROVE',
      scope: 'SELECTION',
      start: 0,
      end: doc.content.length + 100,
      revision: doc.revision,
    });

    expect(status).toBe(400);
  });
});

describe('cuando el proveedor falla', () => {
  it('un fallo pasajero se reintenta y la propuesta llega igual', async () => {
    proveedor.program({ text: 'a la segunda', failWith: 'TRANSIENT', failTimes: 1 });

    const { status, eventos } = await pedir(ana, await seleccion());

    expect(status).toBe(200);
    expect(textoDe(eventos)).toBe('a la segunda');
    expect((await ultimaInvocacion())?.outcome).toBe('COMPLETED');
  });

  /*
   * Un `AUTH` no se reintenta: la credencial va a seguir revocada, y repetir
   * solo acumula fallos contra el proveedor (RNF-703).
   */
  it('una credencial rechazada no se reintenta, y se dice qué hacer', async () => {
    proveedor.program({ failWith: 'AUTH' });

    const { eventos } = await pedir(ana, await seleccion());
    const error = eventos.find((evento) => evento.type === 'error');

    expect(error?.['kind']).toBe('AUTH');
    expect(error?.['message']).toMatch(/owner/i);
    expect(proveedor.calls.filter((llamada) => llamada.operation === 'streamText')).toHaveLength(1);
    expect((await ultimaInvocacion())?.outcome).toBe('FAILED');
  });

  /*
   * El error viaja como **evento** y no como código de estado porque para
   * entonces ya se han enviado las cabeceras: a media respuesta no queda estado
   * que dar, y cortar sin más dejaría al cliente sin saber si terminó o se rompió.
   */
  it('el fallo llega dentro del flujo, no como un 500', async () => {
    proveedor.program({ failWith: 'CONTENT_FILTER' });

    const { status, eventos } = await pedir(ana, await seleccion());

    expect(status).toBe(200);
    expect(eventos.at(-1)?.type).toBe('error');
  });

  /*
   * Y si no para de fallar, se deja de llamarlo (RNF-704). Lo que se gana es una
   * respuesta inmediata y con motivo, en vez de medio minuto de espera para el
   * mismo fallo.
   */
  it('fallando sin parar, el cortacircuitos deja de intentarlo', async () => {
    proveedor.program({ failWith: 'TRANSIENT' });

    let abierto = false;
    for (let intento = 0; intento < 8 && !abierto; intento += 1) {
      const { status } = await pedir(ana, await seleccion());
      abierto = status === 503;
    }

    expect(abierto).toBe(true);

    /* Cerrado a mano: es estado compartido y no puede quedar puesto para el resto. */
    await cortacircuitos.recordSuccess(AiProvider.ANTHROPIC);
    proveedor.program({ text: 'ya responde' });
    expect((await pedir(ana, await seleccion())).status).toBe(200);
  }, 60_000);
});

describe('cancelar', () => {
  /*
   * Irse a mitad tiene que cortar la llamada al proveedor, no solo dejar de
   * mirarla: lo contrario sería seguir gastando la cuota de alguien en un texto
   * que ya nadie va a leer (RF-1407, TRD §11.1).
   */
  it('cerrar la conexión corta la llamada y se registra como cancelada', async () => {
    proveedor.program({ text: 'uno dos tres cuatro cinco seis siete ocho', delayMs: 60 });
    const cuerpo = await seleccion();

    const abort = new AbortController();
    const respuesta = await fetch(`${h.baseUrl}/api/v1/apps/${appId}/document/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `foundry_session=${ana.token}` },
      body: JSON.stringify(cuerpo),
      signal: abort.signal,
    });

    /* Se espera a que empiece a llegar texto: cancelar antes no probaría nada. */
    const lector = respuesta.body!.getReader();
    await lector.read();
    await lector.read();
    abort.abort();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const fila = await ultimaInvocacion();
    expect(fila?.outcome).toBe('CANCELLED');
    /* Lo consumido antes de cortar se consumió igual, y se registra. */
    expect(fila?.outputTokens).toBeGreaterThan(0);
  }, 30_000);
});
