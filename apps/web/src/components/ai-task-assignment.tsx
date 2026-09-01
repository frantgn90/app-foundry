import { Badge } from './ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import {
  type AiModel,
  type AiProviderId,
  type AiTaskAssignment,
  type AiTaskId,
  useAiModels,
  useAiTasks,
  useAssignTaskModel,
} from '../lib/api.js';

const TAREAS: Record<AiTaskId, { titulo: string; para: string }> = {
  IDEA_GENERATION: {
    titulo: 'Coming up with ideas',
    para: 'Proposes app ideas from your constraints. Reasoning matters more than speed here.',
  },
  TEXT_ASSIST: {
    titulo: 'Helping you write',
    para: 'Rewrites a selection or the whole vision. Short texts, so latency is what you notice.',
  },
  AGENT_REVIEW: {
    titulo: 'Agents reviewing a vision',
    para: 'Reads the document and opens threads on specific fragments.',
  },
  AGENT_REPLY: {
    titulo: 'Agents replying in a thread',
    para: 'Answers when someone mentions them or replies to them.',
  },
};

/**
 * Qué modelo atiende cada tarea (RF-1101, RF-1102).
 *
 * La lista se dibuja a partir de las **capacidades declaradas** y no de una
 * lista de proveedores conocidos (RF-1008): así, añadir un proveedor nuevo no
 * obliga a tocar esta pantalla.
 */
export function AiTaskAssignments({ workspaceId }: { workspaceId: string }) {
  const tareas = useAiTasks(workspaceId);
  const modelos = useAiModels(workspaceId, true);
  const asignar = useAssignTaskModel(workspaceId);

  const disponibles = (modelos.data ?? []).filter((m) => m.available);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What runs each task</CardTitle>
        <CardDescription>
          You pick this once; nobody else chooses a model. It is where you decide what your quota
          gets spent on — a fast model for rewriting a paragraph, a capable one for reasoning.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {disponibles.length === 0 && (
          <p className="text-sm text-[var(--color-texto-suave)]">
            No models yet. Configure a provider above and its catalogue will show up here.
          </p>
        )}

        {(tareas.data ?? []).map((asignacion) => (
          <TaskRow
            key={asignacion.task}
            asignacion={asignacion}
            modelos={disponibles}
            onAssign={(provider, modelId) => {
              asignar.mutate({ task: asignacion.task, provider, modelId });
            }}
          />
        ))}

        {asignar.isError && (
          <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
            {asignar.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({
  asignacion,
  modelos,
  onAssign,
}: {
  asignacion: AiTaskAssignment;
  modelos: AiModel[];
  onAssign: (provider: AiProviderId, modelId: string) => void;
}) {
  const definicion = TAREAS[asignacion.task];
  const valor = asignacion.provider ? `${asignacion.provider}::${asignacion.modelId ?? ''}` : '';

  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--color-borde)] pt-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{definicion.titulo}</span>
        <Estado asignacion={asignacion} />
      </div>
      <p className="text-xs text-[var(--color-texto-suave)]">{definicion.para}</p>

      <select
        className="mt-1 rounded-md border border-[var(--color-borde)] bg-transparent px-2 py-1.5 text-sm"
        value={valor}
        onChange={(event) => {
          const [provider, modelId] = event.target.value.split('::');
          if (provider && modelId) onAssign(provider as AiProviderId, modelId);
        }}
      >
        <option value="">Not assigned</option>
        {modelos.map((modelo) => (
          <option
            key={`${modelo.provider}::${modelo.id}`}
            value={`${modelo.provider}::${modelo.id}`}
          >
            {modelo.provider} · {modelo.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Por qué una tarea no se puede ofrecer.
 *
 * Que falte el modelo y que al proveedor le falte una capacidad dejan la tarea
 * igual de inservible, pero lo que hay que hacer con cada una es distinto, así
 * que se dicen por separado (RF-1009).
 */
function Estado({ asignacion }: { asignacion: AiTaskAssignment }) {
  if (!asignacion.provider) return <Badge>Not set up</Badge>;
  if (!asignacion.modelAvailable) return <Badge tone="warning">Model retired</Badge>;
  if (!asignacion.supported) {
    return <Badge tone="warning">Needs {asignacion.missing.join(', ')}</Badge>;
  }
  if (asignacion.degraded.length > 0) {
    return <Badge>Works, without {asignacion.degraded.join(', ')}</Badge>;
  }
  return <Badge tone="ok">Ready</Badge>;
}
