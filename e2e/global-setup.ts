import { arrancarWorker } from './helpers/worker.js';

/**
 * Lo que hay que tener en pie y no es un servidor web.
 *
 * De momento, el worker de las colas de IA: sin él una mención a un agente se
 * encola y no la atiende nadie, y el recorrido de agentes esperaría en vano una
 * respuesta que nunca se va a escribir.
 */
export default async function globalSetup(): Promise<void> {
  await arrancarWorker();
}
