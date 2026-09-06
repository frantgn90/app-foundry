import type { MentionableAgent } from './mention-input.js';

/**
 * Que el agente leerá la última versión, no lo que hay a medio escribir.
 *
 * Un agente contesta sobre la **versión commiteada** (RF-1607): un comentario
 * inline pertenece a la versión sobre la que se escribió, y anclarlo a texto sin
 * commitear sería nacer huérfano. La consecuencia se nota al preguntar por un
 * párrafo que acabas de escribir y recibir una respuesta que no lo menciona: sin
 * este aviso, eso se lee como que el agente no se ha enterado.
 *
 * Aparece solo cuando **las dos cosas** son ciertas: hay cambios sin commitear y
 * el texto llama a un agente. Un aviso permanente al lado del campo lo leería
 * nadie a la tercera vez.
 */
export function AgentSeesNotice({
  draft,
  agents,
  hayCambiosSinCommitear,
}: {
  draft: string;
  agents: MentionableAgent[];
  hayCambiosSinCommitear: boolean;
}) {
  if (!hayCambiosSinCommitear || !mencionaAgente(draft, agents)) return null;

  return (
    <p className="text-xs text-[var(--color-texto-suave)]">
      Heads up: agents read the last committed version, so your uncommitted changes are not in what
      it will see.
    </p>
  );
}

/**
 * Si el texto llama a alguno de estos agentes.
 *
 * Mismo criterio que el extractor del servidor —`@` y el handle, sin distinguir
 * mayúsculas— pero aquí no decide nada: solo si se enseña una línea. Que se
 * equivoque de más es un aviso de sobra; que se equivocara de menos sería
 * callarse justo cuando hacía falta.
 */
function mencionaAgente(draft: string, agents: MentionableAgent[]): boolean {
  const escritos = new Set([...draft.matchAll(/@([A-Za-z\d-]+)/g)].map((m) => m[1]!.toLowerCase()));
  return agents.some((agente) => escritos.has(agente.handle.toLowerCase()));
}
