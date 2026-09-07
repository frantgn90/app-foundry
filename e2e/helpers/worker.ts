import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * El worker de las colas de IA, para los recorridos que lo necesitan.
 *
 * No va como `webServer` de Playwright porque no es un servidor: no abre puerto
 * y no hay URL que sondear. Se arranca aquí, se espera a su línea de «listo» y
 * se para al terminar.
 *
 * Con el **proveedor de mentira**, igual que la API de esta configuración: un
 * agente que contesta llamando de verdad a un modelo gastaría la cuota de quien
 * ejecute los tests, y encima ataría el resultado a que un tercero esté en pie.
 */
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let proceso: ChildProcess | null = null;

export async function arrancarWorker(): Promise<void> {
  exigirQueNoHayaOtro();

  proceso = spawn('node', ['apps/worker/dist/main.js'], {
    cwd: raiz,
    env: {
      ...process.env,
      OTEL_ENABLED: 'false',
      AI_USE_FAKE_PROVIDER: 'true',
      /*
       * El proveedor de mentira, a cámara lenta a propósito.
       *
       * Sin retardo una revisión termina antes de que el navegador llegue a
       * pintar el progreso, y cancelarla a mitad sería imposible de probar
       * desde fuera. Un cuarto de segundo por trozo basta para que se vea
       * correr y sigue siendo instantáneo comparado con un modelo real.
       */
      AI_FAKE_DELAY_MS: '250',
      /* La misma llave de juguete que la API de esta configuración: si no
         coincide, el worker no puede descifrar la credencial que escribió el
         recorrido y el agente se queda mudo por un motivo que no es el suyo. */
      AI_CREDENTIAL_KEYS: `1:${Buffer.alloc(32, 7).toString('base64')}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await aQueDigaQueEstaListo(proceso);

  /*
   * A partir de aquí su salida se reenvía a la consola de los recorridos.
   *
   * Sin esto, un trabajo que falla dentro del worker se ve desde fuera como un
   * comentario que no aparece: el recorrido agota su espera y no dice por qué.
   * El prefijo es para no confundirla con la de la API, que Playwright ya
   * reenvía con el suyo.
   */
  proceso.stdout?.on('data', (trozo: Buffer) => {
    process.stdout.write(`[worker] ${trozo.toString()}`);
  });
  proceso.stderr?.on('data', (trozo: Buffer) => {
    process.stdout.write(`[worker] ${trozo.toString()}`);
  });
}

export function pararWorker(): void {
  proceso?.kill('SIGTERM');
  proceso = null;
}

/**
 * Un worker de desarrollo en marcha se llevaría los trabajos.
 *
 * Los dos escuchan la misma cola, así que BullMQ le daría la mención a
 * cualquiera de los dos, y el de desarrollo llama al proveedor de verdad con
 * una credencial de mentira. El recorrido fallaría una vez de cada dos y por un
 * motivo que no se ve en el fallo. Mejor decirlo antes y en una línea.
 */
function exigirQueNoHayaOtro(): void {
  /*
   * El patrón va **anclado a un `node` al principio** y no suelto.
   *
   * `pgrep -f` compara con la línea de órdenes entera de cada proceso, así que
   * un patrón suelto se encuentra a sí mismo en cualquier consola que tuviera
   * escrita esa ruta —un `pkill` de la orden anterior, por ejemplo— y el
   * recorrido se negaba a arrancar por un worker que no existía. Se vio
   * ejecutándolo desde una terminal donde acababa de escribirse.
   */
  let salida: string;
  try {
    salida = execFileSync('pgrep', ['-f', '^[^ ]*node .*apps/worker/dist/main\\.js'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    /* `pgrep` sale con 1 cuando no encuentra nada: eso es justo lo que se busca. */
    return;
  }

  const ajenos = salida
    .split('\n')
    .filter((pid) => pid.length > 0 && pid !== String(process.pid) && pid !== String(process.ppid));
  if (ajenos.length === 0) return;

  throw new Error(
    'Hay un worker en marcha y comparte cola con el de los recorridos: párralo antes ' +
      `(pkill -f apps/worker/dist/main.js). Procesos: ${ajenos.join(', ')}`,
  );
}

function aQueDigaQueEstaListo(hijo: ChildProcess): Promise<void> {
  return new Promise((listo, fallo) => {
    const plazo = setTimeout(() => {
      fallo(new Error(`El worker no arrancó a tiempo. Salida:\n${registro}`));
    }, 60_000);

    let registro = '';
    const mirar = (trozo: Buffer): void => {
      registro += trozo.toString();
      /* Su propia línea de arranque, la que dice a qué cola escucha. */
      if (registro.includes('worker listo')) {
        clearTimeout(plazo);
        listo();
      }
    };

    hijo.stdout?.on('data', mirar);
    hijo.stderr?.on('data', mirar);
    hijo.on('exit', (codigo) => {
      clearTimeout(plazo);
      fallo(new Error(`El worker se cerró con código ${String(codigo)}. Salida:\n${registro}`));
    });
  });
}
