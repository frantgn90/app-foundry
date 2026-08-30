import { useState } from 'react';

import { AuditList } from '../components/audit-list.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import {
  useAdminUsers,
  useInstanceMetrics,
  usePlatformAudit,
  useUpdateAdminUser,
} from '../lib/api.js';
import { cn } from '../lib/utils.js';

type Panel = 'accounts' | 'audit';

/**
 * Administración de la instancia (RF-205).
 *
 * Va en su propia pantalla y no mezclada con el trabajo normal: son cosas que se
 * hacen muy de vez en cuando y que conviene hacer despacio.
 */
export function AdminPage() {
  const [panel, setPanel] = useState<Panel>('accounts');
  const cuentas = useAdminUsers(true);
  const metricas = useInstanceMetrics(true);
  const auditoria = usePlatformAudit(panel === 'audit');
  const actualizar = useUpdateAdminUser();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Instance administration</h1>
        <p className="text-sm text-[var(--color-texto-suave)]">
          Accounts and platform events. Not the contents of anyone&apos;s workspace.
        </p>
      </header>

      {metricas.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Accounts" value={metricas.data['usersTotal'] ?? 0} />
          <Metric label="Active" value={metricas.data['usersActive'] ?? 0} />
          <Metric label="Workspaces" value={metricas.data['workspacesTotal'] ?? 0} />
          <Metric label="Apps" value={metricas.data['appsTotal'] ?? 0} />
        </div>
      )}

      <nav className="flex gap-4 text-sm">
        {(['accounts', 'audit'] as const).map((p) => (
          <button
            key={p}
            onClick={() => {
              setPanel(p);
            }}
            className={
              panel === p
                ? 'font-medium'
                : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]'
            }
          >
            {p === 'accounts' ? 'Accounts' : 'Platform activity'}
          </button>
        ))}
      </nav>

      {panel === 'accounts' && (
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            {actualizar.isError && (
              <p className="mb-3 text-sm" style={{ color: 'var(--color-fallo)' }}>
                {/*
                  El caso normal de fallo aquí es intentar dejar la instancia sin
                  ningún administrador activo, y conviene decirlo tal cual: la
                  base de datos lo impide, no es un error pasajero.
                */}
                That change would leave the instance without an active administrator.
              </p>
            )}

            <ul className="flex flex-col">
              {(cuentas.data ?? []).map((cuenta) => (
                <li
                  key={cuenta.id}
                  className="flex flex-wrap items-center gap-2 border-b border-[var(--color-borde)] py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">@{cuenta.handle}</span>
                      {cuenta.platformRole === 'ADMIN' && <Badge tone="ok">Admin</Badge>}
                      {cuenta.status === 'DEACTIVATED' && <Badge>Deactivated</Badge>}
                      {cuenta.isMe && (
                        <span className="text-xs text-[var(--color-texto-suave)]">you</span>
                      )}
                    </span>
                    <span className="truncate text-xs text-[var(--color-texto-suave)]">
                      {cuenta.displayName} · {cuenta.workspaceCount} workspace
                      {cuenta.workspaceCount === 1 ? '' : 's'} ·{' '}
                      {cuenta.lastLoginAt
                        ? `last seen ${new Date(cuenta.lastLoginAt).toLocaleDateString()}`
                        : 'never signed in'}
                    </span>
                  </span>

                  <span className="flex gap-1">
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      disabled={actualizar.isPending}
                      onClick={() => {
                        actualizar.mutate({
                          id: cuenta.id,
                          platformRole: cuenta.platformRole === 'ADMIN' ? 'MEMBER' : 'ADMIN',
                        });
                      }}
                    >
                      {cuenta.platformRole === 'ADMIN' ? 'Make member' : 'Make admin'}
                    </Button>
                    <Button
                      variant={cuenta.status === 'ACTIVE' ? 'danger' : 'secondary'}
                      className="px-2 py-1 text-xs"
                      disabled={actualizar.isPending}
                      onClick={() => {
                        actualizar.mutate({
                          id: cuenta.id,
                          status: cuenta.status === 'ACTIVE' ? 'DEACTIVATED' : 'ACTIVE',
                        });
                      }}
                    >
                      {cuenta.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {panel === 'audit' && (
        <Card>
          <CardHeader>
            <CardTitle>Platform activity</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditList entradas={auditoria.data ?? []} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border border-[var(--color-borde)] p-3',
        'bg-[var(--color-superficie)]',
      )}
    >
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-[var(--color-texto-suave)]">{label}</span>
    </div>
  );
}
