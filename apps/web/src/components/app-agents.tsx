import { useState } from 'react';

import {
  type Agent,
  useAddAgent,
  useAdoptTemplateChange,
  useAgents,
  useAgentTemplates,
  useAiTaskAvailable,
  useMutedAgents,
  useMuteAgent,
  useRemoveAgent,
  useUpdateAgent,
} from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { AgentIcon } from './agent-icon.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';

/**
 * Los agentes de esta app (RF-1511).
 *
 * Van en los ajustes de la app y no junto al documento porque son parte de
 * **cómo está montada**, igual que quién la ve o cómo se llama: se configuran
 * una vez y luego se les habla desde los comentarios.
 *
 * No aparecen en la lista de contribuidores, que sigue saliendo del historial de
 * versiones y es de personas (RF-1511, D-8).
 */
export function AppAgents({
  appId,
  workspaceId,
  puedeEditar,
}: {
  appId: string;
  workspaceId: string;
  puedeEditar: boolean;
}) {
  const agentes = useAgents(appId);
  const plantillas = useAgentTemplates(workspaceId);
  const silenciados = useMutedAgents(appId);
  const añadir = useAddAgent(appId);
  const disponible = useAiTaskAvailable(workspaceId, 'AGENT_REPLY');

  /*
   * Sin disponibilidad no se ofrece nada (RF-1010). Ni con la IA apagada, ni
   * sin modelo asignado a su tarea: un agente que no puede contestar es un
   * botón que promete algo que no va a pasar.
   *
   * Los que ya existan sí se siguen viendo: quitarlos de la pantalla al apagar
   * la IA daría a entender que se han borrado.
   */
  if (!disponible && (agentes.data?.length ?? 0) === 0) return null;

  const sinPlantillas = (plantillas.data?.length ?? 0) === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>
          Profiles that can join the conversation on this app. They only write comments — mention
          one with its handle and it answers in the thread.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!disponible && (
          <p className="text-sm text-[var(--color-texto-suave)]">
            AI is off in this workspace, so these agents will not answer until it is back on.
          </p>
        )}

        {agentes.data?.length === 0 && (
          <p className="text-sm text-[var(--color-texto-suave)]">
            No agents here yet.{' '}
            {sinPlantillas
              ? 'Add a template in the workspace AI settings first.'
              : 'Add one from the templates below.'}
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {agentes.data?.map((agente) => (
            <AgenteDeLaApp
              key={agente.id}
              agente={agente}
              appId={appId}
              puedeEditar={puedeEditar}
              silenciado={silenciados.data?.includes(agente.id) ?? false}
            />
          ))}
        </ul>

        {puedeEditar && disponible && !sinPlantillas && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-borde)] pt-3">
            <span className="text-xs text-[var(--color-texto-suave)]">Add from a template:</span>
            {plantillas.data?.map((plantilla) => (
              <Button
                key={plantilla.id}
                variant="secondary"
                className="text-xs"
                disabled={añadir.isPending}
                onClick={() => {
                  añadir.mutate({ templateId: plantilla.id });
                }}
              >
                {plantilla.iconEmoji} {plantilla.name}
              </Button>
            ))}
            {añadir.isError && (
              <p className="w-full text-xs text-[var(--color-fallo)]">{añadir.error.message}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgenteDeLaApp({
  agente,
  appId,
  puedeEditar,
  silenciado,
}: {
  agente: Agent;
  appId: string;
  puedeEditar: boolean;
  silenciado: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [prompt, setPrompt] = useState(agente.prompt);
  const guardar = useUpdateAgent(appId);
  const adoptar = useAdoptTemplateChange(appId);
  const retirar = useRemoveAgent(appId);
  const silenciar = useMuteAgent(appId);

  return (
    <li className="rounded-lg border border-[var(--color-borde)] p-3">
      <div className="flex items-start gap-3">
        <AgentIcon emoji={agente.iconEmoji} color={agente.iconColor} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{agente.name}</span>
            <span className="text-xs text-[var(--color-texto-suave)]">@{agente.handle}</span>
            {/* Un agente inactivo se queda: deja de intervenir, no se borra (RF-1508). */}
            {!agente.active && <Badge>Paused</Badge>}
          </div>
          <p className="text-xs text-[var(--color-texto-suave)]">
            {agente.template ? `From ${agente.template.name}` : 'Its template was deleted'}
            {agente.template?.drifted ? ' · edited for this app' : ''}
          </p>
        </div>

        {/* Silenciar es de quien mira y no del que edita: es su bandeja (RF-1612). */}
        <Button
          variant="ghost"
          className="shrink-0 text-xs"
          title={silenciado ? 'You are not being notified about this agent' : 'Mute notifications'}
          disabled={silenciar.isPending}
          onClick={() => {
            silenciar.mutate({ agentId: agente.id, muted: !silenciado });
          }}
        >
          {silenciado ? 'Muted' : 'Mute'}
        </Button>

        {puedeEditar && (
          <>
            <Button
              variant="secondary"
              className="shrink-0 text-xs"
              disabled={guardar.isPending}
              onClick={() => {
                guardar.mutate({ id: agente.id, active: !agente.active });
              }}
            >
              {agente.active ? 'Pause' : 'Resume'}
            </Button>
            <Button
              variant="secondary"
              className="shrink-0 text-xs"
              onClick={() => {
                setPrompt(agente.prompt);
                setEditando(!editando);
              }}
            >
              {editando ? 'Cancel' : 'Edit'}
            </Button>
            <Button
              variant="danger"
              className="shrink-0 text-xs"
              disabled={retirar.isPending}
              title="What it wrote stays where it is"
              onClick={() => {
                retirar.mutate(agente.id);
              }}
            >
              Remove
            </Button>
          </>
        )}
      </div>

      {/*
        Que la plantilla cambió se avisa aquí y se adopta desde aquí (RF-1505):
        es una decisión de quien edita esta app, no del dueño del workspace, y
        por eso no se propaga sola.
      */}
      {puedeEditar && agente.template?.drifted && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-texto-suave)]">
            This agent&apos;s prompt differs from {agente.template.name}.
          </span>
          <Button
            variant="ghost"
            className="text-xs"
            disabled={adoptar.isPending}
            onClick={() => {
              adoptar.mutate(agente.id);
            }}
          >
            Use the template&apos;s version
          </Button>
        </div>
      )}

      {editando ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            className={cn(
              'min-h-40 w-full rounded-lg border border-[var(--color-borde)] p-2',
              'bg-[var(--color-superficie)] font-mono text-xs',
            )}
            value={prompt}
            onChange={(evento) => {
              setPrompt(evento.target.value);
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              className="text-xs"
              disabled={guardar.isPending || prompt.trim().length === 0}
              onClick={() => {
                guardar.mutate({ id: agente.id, prompt }, { onSuccess: () => setEditando(false) });
              }}
            >
              Save
            </Button>
            {/*
              Se dice porque cambia lo que significa el botón: no se sobrescribe
              nada, se añade. Lo que este agente ya escribió sigue explicándose
              con el perfil que tenía entonces (RF-1510).
            */}
            <p className="text-xs text-[var(--color-texto-suave)]">
              Saving adds a revision. What it already wrote keeps the prompt it had then.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 line-clamp-2 text-xs text-[var(--color-texto-suave)]">{agente.prompt}</p>
      )}
    </li>
  );
}
