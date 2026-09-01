import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import { type AiUsage, useAiUsage } from '../lib/api.js';

/**
 * Lo consumido este mes (RF-1208).
 *
 * En tokens y no en dinero: las tarifas son un dato de terceros que cambia sin
 * avisarnos, y poner un importe aparentaría una precisión que no tenemos
 * (D-37). Entrada y salida van separadas porque no cuestan lo mismo en ningún
 * proveedor, y el día que haya precios se podrá valorar el histórico entero.
 */
export function AiUsagePanel({ workspaceId }: { workspaceId: string }) {
  const consumo = useAiUsage(workspaceId, true);
  if (!consumo.data) return null;

  const { month, providers, byTask, byModel, byMember } = consumo.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>This month</CardTitle>
        <CardDescription>
          Tokens used in {month} (UTC). Input and output are counted separately because they never
          cost the same.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {providers.length === 0 && byTask.length === 0 && (
          <p className="text-sm text-[var(--color-texto-suave)]">Nothing used yet this month.</p>
        )}

        {providers.map((p) => (
          <Cupo key={p.provider} proveedor={p} />
        ))}

        <Desglose titulo="By task" filas={byTask} />
        <Desglose titulo="By model" filas={byModel} />
        <Desglose titulo="By person" filas={byMember} />
      </CardContent>
    </Card>
  );
}

function Cupo({ proveedor }: { proveedor: AiUsage['providers'][number] }) {
  const { quota, spentTokens, reservedTokens } = proveedor;
  const porcentaje = quota ? Math.min(100, Math.round((spentTokens / quota) * 100)) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{proveedor.provider}</span>
        <span className="text-[var(--color-texto-suave)]">
          {miles(spentTokens)}
          {quota === null ? ' tokens · no quota' : ` / ${miles(quota)} tokens`}
          {/* Lo apartado por invocaciones en curso: sin esto, el número parpadearía sin explicación. */}
          {reservedTokens > 0 && ` · ${miles(reservedTokens)} in flight`}
        </span>
      </div>

      {porcentaje !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-[var(--color-borde)]"
          role="progressbar"
          aria-valuenow={porcentaje}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${proveedor.provider} quota used`}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${String(porcentaje)}%`,
              background: porcentaje >= 80 ? 'var(--color-fallo)' : 'var(--color-ok)',
            }}
          />
        </div>
      )}
    </div>
  );
}

function Desglose({ titulo, filas }: { titulo: string; filas: AiUsage['byTask'] }) {
  if (filas.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-texto-suave)]">{titulo}</span>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-texto-suave)]">
              <th className="py-1 font-normal">Name</th>
              <th className="py-1 text-right font-normal">In</th>
              <th className="py-1 text-right font-normal">Out</th>
              <th className="py-1 text-right font-normal">Calls</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.key} className="border-t border-[var(--color-borde)]">
                <td className="py-1">{fila.key}</td>
                <td className="py-1 text-right tabular-nums">{miles(fila.inputTokens)}</td>
                <td className="py-1 text-right tabular-nums">{miles(fila.outputTokens)}</td>
                <td className="py-1 text-right tabular-nums">{fila.invocations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function miles(valor: number): string {
  return valor.toLocaleString('en-US');
}
