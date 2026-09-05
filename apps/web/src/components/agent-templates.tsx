import { useState } from 'react';

import {
  type AgentTemplate,
  useAdoptAgentTemplate,
  useAgentCatalog,
  useAgentTemplates,
  useCreateAgentTemplate,
  useDeleteAgentTemplate,
  useUpdateAgentTemplate,
} from '../lib/api.js';
import { cn } from '../lib/utils.js';
import { AgentIcon } from './agent-icon.js';
import { Button } from './ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card.js';
import { Input } from './ui/input.js';

/**
 * Las plantillas de agente del workspace (RF-1501, RF-1502).
 *
 * Un workspace sin plantillas propias no enseña un hueco: enseña el catálogo de
 * fábrica, que es lo que hace que estrenar la función no empiece por redactar un
 * prompt de personalidad delante de una caja vacía (RF-1515).
 */
export function AgentTemplates({ workspaceId }: { workspaceId: string }) {
  const plantillas = useAgentTemplates(workspaceId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent templates</CardTitle>
        <CardDescription>
          Reusable profiles for this workspace. Adding one to an app creates a copy that lives its
          own life: editing the copy never touches the template, and editing the template never
          reaches the copies.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {plantillas.data && plantillas.data.length > 0 && (
          <ul className="flex flex-col gap-3">
            {plantillas.data.map((plantilla) => (
              <PlantillaPropia key={plantilla.id} plantilla={plantilla} workspaceId={workspaceId} />
            ))}
          </ul>
        )}

        <Catalogo workspaceId={workspaceId} vacio={plantillas.data?.length === 0} />
      </CardContent>
    </Card>
  );
}

function PlantillaPropia({
  plantilla,
  workspaceId,
}: {
  plantilla: AgentTemplate;
  workspaceId: string;
}) {
  const [editando, setEditando] = useState(false);
  const [prompt, setPrompt] = useState(plantilla.prompt);
  const guardar = useUpdateAgentTemplate(workspaceId);
  const borrar = useDeleteAgentTemplate(workspaceId);

  return (
    <li className="rounded-lg border border-[var(--color-borde)] p-3">
      <div className="flex items-start gap-3">
        <AgentIcon emoji={plantilla.iconEmoji} color={plantilla.iconColor} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{plantilla.name}</p>
          <p className="text-xs text-[var(--color-texto-suave)]">@{plantilla.handle}</p>
        </div>
        <Button
          variant="secondary"
          className="shrink-0 text-xs"
          onClick={() => {
            setPrompt(plantilla.prompt);
            setEditando(!editando);
          }}
        >
          {editando ? 'Cancel' : 'Edit'}
        </Button>
        <Button
          variant="danger"
          className="shrink-0 text-xs"
          onClick={() => {
            borrar.mutate(plantilla.id);
          }}
          disabled={borrar.isPending}
        >
          Delete
        </Button>
      </div>

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
                guardar.mutate(
                  { id: plantilla.id, prompt },
                  { onSuccess: () => setEditando(false) },
                );
              }}
            >
              Save
            </Button>
            {/*
              Se dice aquí y no en un aviso aparte: es justo cuando alguien está
              a punto de cambiar el prompt cuando importa saber que las
              instancias ya creadas no se van a enterar (RF-1505).
            */}
            <p className="text-xs text-[var(--color-texto-suave)]">
              Agents already created from this template keep their own prompt.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 line-clamp-2 text-xs text-[var(--color-texto-suave)]">
          {plantilla.prompt}
        </p>
      )}
    </li>
  );
}

/**
 * El catálogo de fábrica.
 *
 * Se enseña siempre, no solo cuando no hay nada: adoptar un segundo perfil es
 * tan normal como adoptar el primero. Lo que cambia con el workspace vacío es el
 * texto de encima, que ahí es una invitación y no una lista más.
 */
function Catalogo({ workspaceId, vacio }: { workspaceId: string; vacio: boolean }) {
  const catalogo = useAgentCatalog(workspaceId);
  const adoptar = useAdoptAgentTemplate(workspaceId);

  if (catalogo.isPending) {
    return <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">
          {vacio ? 'Start with one of these' : 'Add another profile'}
        </h3>
        <p className="text-xs text-[var(--color-texto-suave)]">
          Six profiles that ask different questions about the same idea. Adopting one copies it
          here, and from then on it is yours to edit.
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {catalogo.data?.map((perfil) => (
          <li
            key={perfil.key}
            className="flex items-start gap-3 rounded-lg border border-[var(--color-borde)] p-3"
          >
            <AgentIcon emoji={perfil.iconEmoji} color={perfil.iconColor} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{perfil.name}</p>
              <p className="text-xs text-[var(--color-texto-suave)]">{perfil.summary}</p>
              {/*
                Se dice antes de elegir con qué handle entraría, no después con
                un error: enterarse por un rechazo obliga a inventar un nombre
                justo cuando uno solo quería empezar a probar (RF-1515).
              */}
              <p className="mt-1 text-xs text-[var(--color-texto-suave)]">
                {perfil.handleTaken
                  ? `@${perfil.handle} is taken here — it would come in as @${perfil.availableHandle}`
                  : `@${perfil.handle}`}
              </p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0 text-xs"
              disabled={adoptar.isPending}
              onClick={() => {
                adoptar.mutate({ key: perfil.key, handle: perfil.availableHandle });
              }}
            >
              Add
            </Button>
          </li>
        ))}
      </ul>

      <NuevaPlantilla workspaceId={workspaceId} />
    </div>
  );
}

/** Y por si ninguno de los seis sirve: uno propio, desde cero (RF-1501). */
function NuevaPlantilla({ workspaceId }: { workspaceId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [handle, setHandle] = useState('');
  const [prompt, setPrompt] = useState('');
  const crear = useCreateAgentTemplate(workspaceId);

  if (!abierto) {
    return (
      <Button
        variant="ghost"
        className="self-start text-xs"
        onClick={() => {
          setAbierto(true);
        }}
      >
        Or write one from scratch
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-borde)] p-3">
      <Input
        placeholder="Name"
        value={nombre}
        onChange={(evento) => {
          setNombre(evento.target.value);
        }}
      />
      <Input
        placeholder="handle"
        value={handle}
        onChange={(evento) => {
          setHandle(evento.target.value);
        }}
      />
      <textarea
        className={cn(
          'min-h-32 w-full rounded-lg border border-[var(--color-borde)] p-2',
          'bg-[var(--color-superficie)] font-mono text-xs',
        )}
        placeholder="What this agent cares about, and what it should push back on."
        value={prompt}
        onChange={(evento) => {
          setPrompt(evento.target.value);
        }}
      />
      <div className="flex gap-2">
        <Button
          className="text-xs"
          disabled={crear.isPending || !nombre.trim() || !handle.trim() || !prompt.trim()}
          onClick={() => {
            crear.mutate(
              { name: nombre, handle, prompt },
              {
                onSuccess: () => {
                  setAbierto(false);
                  setNombre('');
                  setHandle('');
                  setPrompt('');
                },
              },
            );
          }}
        >
          Create
        </Button>
        <Button
          variant="secondary"
          className="text-xs"
          onClick={() => {
            setAbierto(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {crear.isError && <p className="text-xs text-[var(--color-fallo)]">{crear.error.message}</p>}
    </div>
  );
}
