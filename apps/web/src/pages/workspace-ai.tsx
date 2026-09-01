import { type FormEvent, useState } from 'react';

import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import {
  type AiProvider,
  type AiProviderId,
  useAcceptAiConsent,
  useAiProviders,
  useAiSettings,
  useConfigureProvider,
  useRemoveProvider,
  useSetAiEnabled,
  useSetProviderQuota,
  useSetProviderStatus,
  useVerifyProvider,
  type Workspace,
} from '../lib/api.js';

const PROVEEDORES: { id: AiProviderId; nombre: string; pista: string }[] = [
  { id: 'ANTHROPIC', nombre: 'Anthropic', pista: 'sk-ant-…' },
  { id: 'GROQ', nombre: 'Groq', pista: 'gsk_…' },
];

/**
 * Los ajustes de IA del workspace (RF-1002, RF-1004, RF-1011, RF-1012).
 *
 * Es de su dueño y de nadie más: quien pone la clave es quien paga lo que se
 * gaste con ella.
 */
export function WorkspaceAiPage({ workspace }: { workspace: Workspace }) {
  const esDueño = workspace.role === 'OWNER';
  const ajustes = useAiSettings(workspace.id, esDueño);
  const proveedores = useAiProviders(workspace.id);
  const aceptar = useAcceptAiConsent(workspace.id);
  const interruptor = useSetAiEnabled(workspace.id);

  if (!esDueño) {
    return (
      <Card className="p-6">
        <p className="text-sm text-[var(--color-texto-suave)]">
          Only the owner sets up AI here. What it costs comes out of their key.
        </p>
      </Card>
    );
  }

  const consentimiento = ajustes.data?.consent;

  /*
   * Antes que nada, la advertencia (RF-1011). No es letra pequeña: configurar un
   * proveedor es empezar a mandar el texto de las apps fuera de aquí, y eso se
   * acepta a sabiendas o no se hace.
   */
  if (ajustes.data && consentimiento && !consentimiento.accepted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Before you switch this on</CardTitle>
          <CardDescription>
            Using AI sends the text of this workspace&apos;s apps to a third party — the provider
            you configure. Nothing leaves until you set one up, and this cannot be undone: what has
            been sent cannot be unsent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              aceptar.mutate();
            }}
            disabled={aceptar.isPending}
          >
            I understand — let me configure a provider
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>AI in this workspace</CardTitle>
          <CardDescription>
            Turning it off keeps everything as it is — providers, keys and agents — and stops every
            call. {consentimiento?.acceptedBy ? `Accepted by @${consentimiento.acceptedBy}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant={ajustes.data?.enabled ? 'secondary' : 'primary'}
            onClick={() => {
              interruptor.mutate(!(ajustes.data?.enabled ?? true));
            }}
            disabled={interruptor.isPending}
          >
            {ajustes.data?.enabled ? 'Turn AI off' : 'Turn AI back on'}
          </Button>
        </CardContent>
      </Card>

      {PROVEEDORES.map((definicion) => (
        <ProviderCard
          key={definicion.id}
          workspaceId={workspace.id}
          definicion={definicion}
          configurado={proveedores.data?.find((p) => p.provider === definicion.id)}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  workspaceId,
  definicion,
  configurado,
}: {
  workspaceId: string;
  definicion: { id: AiProviderId; nombre: string; pista: string };
  configurado: AiProvider | undefined;
}) {
  const configurar = useConfigureProvider(workspaceId);
  const verificar = useVerifyProvider(workspaceId);
  const cambiarEstado = useSetProviderStatus(workspaceId);
  const quitar = useRemoveProvider(workspaceId);
  const cupo = useSetProviderQuota(workspaceId);

  const [clave, setClave] = useState('');
  const [tope, setTope] = useState(String(configurado?.monthlyTokenQuota ?? ''));

  function guardarClave(event: FormEvent) {
    event.preventDefault();
    configurar.mutate(
      { provider: definicion.id, apiKey: clave },
      {
        onSuccess: () => {
          setClave('');
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{definicion.nombre}</CardTitle>
          {configurado && <EstadoBadge estado={configurado.status} />}
        </div>
        <CardDescription>
          {configurado
            ? /* La clave nunca vuelve del servidor: solo sus últimos caracteres (RF-1004). */
              `Key ending in ${configurado.credentialHint ?? '····'}.`
            : 'Your own key. It is encrypted here and never leaves again.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form onSubmit={guardarClave} className="flex gap-2">
          <Input
            type="password"
            value={clave}
            placeholder={configurado ? 'Replace the key' : definicion.pista}
            autoComplete="off"
            onChange={(e) => {
              setClave(e.target.value);
            }}
          />
          <Button type="submit" disabled={clave.length < 8 || configurar.isPending}>
            {configurado ? 'Replace' : 'Save'}
          </Button>
        </form>

        {/*
          El motivo, tal como lo da el servidor: «rechazada» y «no responde»
          piden cosas distintas, y un mensaje genérico llevaría a regenerar una
          clave que estaba bien.
        */}
        {configurar.isError && (
          <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
            {configurar.error.message}
          </p>
        )}

        {configurado && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  verificar.mutate(definicion.id);
                }}
                disabled={verificar.isPending}
              >
                Check the key
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  cambiarEstado.mutate({
                    provider: definicion.id,
                    status: configurado.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                  });
                }}
                disabled={cambiarEstado.isPending}
              >
                {configurado.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  quitar.mutate(definicion.id);
                }}
                disabled={quitar.isPending}
              >
                Remove
              </Button>
            </div>

            {verificar.isError && (
              <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
                {verificar.error.message}
              </p>
            )}

            {/*
              El cupo va por proveedor porque un millón de tokens no vale lo
              mismo en cada uno: uno solo mediría volumen, no gasto (D-30).
            */}
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                cupo.mutate({
                  provider: definicion.id,
                  monthlyTokenQuota: tope === '' ? null : Number(tope),
                });
              }}
            >
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-[var(--color-texto-suave)]">
                  Monthly token quota — empty means no ceiling
                </span>
                <Input
                  inputMode="numeric"
                  value={tope}
                  placeholder="e.g. 2000000"
                  onChange={(e) => {
                    setTope(e.target.value.replace(/\D/g, ''));
                  }}
                />
              </label>
              <Button type="submit" variant="secondary" disabled={cupo.isPending}>
                Save quota
              </Button>
            </form>

            <Capacidades proveedor={configurado} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EstadoBadge({ estado }: { estado: AiProvider['status'] }) {
  /* `INVALID` no es lo mismo que `DISABLED`: uno lo apagaste tú y el otro dejó de valer solo. */
  if (estado === 'ACTIVE') return <Badge tone="ok">Active</Badge>;
  if (estado === 'DISABLED') return <Badge>Off</Badge>;
  return <Badge tone="warning">Key rejected</Badge>;
}

/** Lo que sabe hacer, que es de donde sale qué funciones se pueden ofrecer (RF-1008). */
function Capacidades({ proveedor }: { proveedor: AiProvider }) {
  const etiquetas = [
    proveedor.capabilities.schemaOutput ? 'structured output' : null,
    proveedor.capabilities.webSearch ? 'web search' : null,
    proveedor.capabilities.exactTokenCount ? 'exact token count' : 'estimated token count',
  ].filter((x): x is string => x !== null);

  return (
    <p className="text-xs text-[var(--color-texto-suave)]">Supports: {etiquetas.join(' · ')}</p>
  );
}
