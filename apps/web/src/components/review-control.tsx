import { useState } from 'react';

import {
  type Review,
  type ReviewEstimate,
  useCancelReview,
  useReview,
  useReviewEstimate,
  useStartReview,
} from '../lib/api.js';
import { Button } from './ui/button.js';
import { cn } from '../lib/utils.js';

/**
 * Pedir que los agentes lean el documento, y ver cómo van (RF-1606..1610).
 *
 * Tres estados y ninguno más: **ofrecer**, **confirmar** y **esperar**. El del
 * medio existe porque esto es el primer gesto caro del producto —cinco agentes
 * leyendo un documento entero son cinco invocaciones que alguien paga— y
 * RF-1207 obliga a enseñar el techo antes de gastarlo.
 *
 * Mientras corre, el progreso llega solo: el worker publica cada cambio de
 * estado y el canal de avisos lo reparte a todos los que ven la app (RF-1609).
 * No hay sondeo.
 */
export function ReviewControl({
  appId,
  hayAgentes,
  sinCommitear,
}: {
  appId: string;
  /** Sin agentes activos no se ofrece: un botón que no puede hacer nada sobra. */
  hayAgentes: boolean;
  /** Para avisar de lo que el agente no va a ver (RF-1607). */
  sinCommitear: boolean;
}) {
  const revision = useReview(appId);
  const estimar = useReviewEstimate(appId);
  const lanzar = useStartReview(appId);
  const parar = useCancelReview(appId);
  const [techo, setTecho] = useState<ReviewEstimate | null>(null);

  const actual = revision.data;
  const corriendo = actual?.status === 'QUEUED' || actual?.status === 'RUNNING';

  if (!hayAgentes && !corriendo) return null;

  if (corriendo)
    return (
      <EnMarcha
        revision={actual}
        onParar={() => {
          parar.mutate(actual.id);
        }}
        parando={parar.isPending}
      />
    );

  return (
    /* `items-start` para que el botón mida lo que dice y no toda la columna. */
    <span className="flex flex-col items-start gap-2">
      {techo === null ? (
        <Button
          variant="secondary"
          className="shrink-0 whitespace-nowrap px-2 py-1 text-sm"
          disabled={estimar.isPending}
          title="Every active agent reads the current version and leaves comments"
          onClick={() => {
            estimar.mutate(undefined, { onSuccess: setTecho });
          }}
        >
          {estimar.isPending ? 'Working it out…' : 'Ask for a review'}
        </Button>
      ) : (
        <Confirmacion
          techo={techo}
          sinCommitear={sinCommitear}
          lanzando={lanzar.isPending}
          onCancelar={() => {
            setTecho(null);
          }}
          onLanzar={() => {
            lanzar.mutate(undefined, { onSuccess: () => setTecho(null) });
          }}
        />
      )}

      {estimar.isError && (
        <p className="text-xs text-[var(--color-fallo)]">{estimar.error.message}</p>
      )}
      {lanzar.isError && (
        <p className="text-xs text-[var(--color-fallo)]">{lanzar.error.message}</p>
      )}
    </span>
  );
}

/**
 * El techo y quiénes van a leer, antes de gastar (RF-1207).
 *
 * El número va en tokens y no en dinero a propósito: el precio depende del
 * modelo y del proveedor y cambia sin avisar, y una cifra en euros que no
 * cuadre con la factura es peor que ninguna.
 */
function Confirmacion({
  techo,
  sinCommitear,
  lanzando,
  onLanzar,
  onCancelar,
}: {
  techo: ReviewEstimate;
  sinCommitear: boolean;
  lanzando: boolean;
  onLanzar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-[var(--color-borde)] bg-[var(--color-superficie)] p-3">
      <p className="text-sm">
        {techo.agents.length === 1
          ? '1 agent will read'
          : `${String(techo.agents.length)} agents will read`}{' '}
        version {techo.versionNo} and leave comments.
      </p>
      <p className="text-xs text-[var(--color-texto-suave)]">
        Up to <strong>{techo.totalTokens.toLocaleString()}</strong> tokens with {techo.modelId} —
        that is the ceiling, not an estimate: {techo.agents.map((a) => `@${a.handle}`).join(', ')}.
      </p>

      {/* Lo mismo que se dice al mencionar a un agente, y por lo mismo (RF-1607). */}
      {sinCommitear && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          Agents read the last committed version, so your uncommitted changes are not in what they
          will see.
        </p>
      )}

      {!techo.fitsInQuota && (
        <p className="text-xs text-[var(--color-fallo)]">
          This does not fit in what is left of this month&apos;s quota
          {techo.remainingTokens === null
            ? ''
            : ` (${techo.remainingTokens.toLocaleString()} tokens)`}
          , so it will not start.
        </p>
      )}

      <span className="flex gap-2">
        <Button
          className="px-2 py-1 text-sm"
          disabled={lanzando || !techo.fitsInQuota}
          onClick={onLanzar}
        >
          {lanzando ? 'Starting…' : 'Start the review'}
        </Button>
        <Button variant="secondary" className="px-2 py-1 text-sm" onClick={onCancelar}>
          Not now
        </Button>
      </span>
    </div>
  );
}

/**
 * Mientras corre: cuántos van, quién falta y cómo pararla.
 *
 * Enseñar los agentes uno a uno y no solo el número es lo que convierte la
 * espera en algo que se entiende: se ve que `@techlead` ya terminó y que
 * `@devil` sigue leyendo, en vez de una barra que no dice de qué depende.
 */
function EnMarcha({
  revision,
  onParar,
  parando,
}: {
  revision: Review;
  onParar: () => void;
  parando: boolean;
}) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-[var(--color-acento)]/40 bg-[var(--color-superficie)] p-3">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          Reviewing… {revision.done} of {revision.runs.length}
        </span>
        {revision.canCancel && (
          <Button
            variant="ghost"
            className="ml-auto px-2 py-1 text-xs"
            disabled={parando}
            title="What is already written stays"
            onClick={onParar}
          >
            {parando ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </span>

      <span className="flex flex-wrap gap-1.5">
        {revision.runs.map((run) => (
          <span
            key={run.agentId}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              run.status === 'DONE'
                ? 'border-[var(--color-acento)]/40 text-[var(--color-acento)]'
                : 'border-[var(--color-borde)] text-[var(--color-texto-suave)]',
            )}
            title={
              run.status === 'DONE'
                ? `${String(run.threadsWritten)} comments`
                : run.status.toLowerCase()
            }
          >
            @{run.handle}
            {run.status === 'DONE' && ` · ${String(run.threadsWritten)}`}
          </span>
        ))}
      </span>
    </div>
  );
}
