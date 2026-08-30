import { AuditList } from '../components/audit-list.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { useWorkspaceAudit, type Workspace } from '../lib/api.js';

/**
 * Actividad del workspace, para su dueño (RF-704).
 *
 * Es lo que permite responder a «¿quién cambió esto?» sin preguntar a nadie. No
 * incluye lo que se escribió, solo lo que se hizo (RF-706).
 */
export function WorkspaceActivityPage({ workspace }: { workspace: Workspace }) {
  const actividad = useWorkspaceAudit(workspace.id, true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          What has happened in {workspace.name}. It records what was done, never what was written.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {actividad.isPending && <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>}
        {actividad.data && <AuditList entradas={actividad.data} />}
      </CardContent>
    </Card>
  );
}
