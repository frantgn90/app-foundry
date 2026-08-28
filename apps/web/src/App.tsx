import { useQuery } from '@tanstack/react-query';

import { createApiClient } from '@app-foundry/contracts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card.js';

// El cliente se deriva del OpenAPI que publica el servidor: si una ruta cambia,
// esto deja de compilar (TRD T-8).
const api = createApiClient();

function Indicador({ estado }: { estado: 'up' | 'down' }) {
  return (
    <span
      className="inline-block size-2 rounded-full"
      style={{ backgroundColor: estado === 'up' ? 'var(--color-ok)' : 'var(--color-fallo)' }}
      aria-hidden
    />
  );
}

export function App() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await api.GET('/health/ready');
      if (error) throw new Error('La API no responde');
      return data;
    },
    refetchInterval: 10_000,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">App Foundry</h1>
        <p className="text-[var(--color-texto-suave)]">
          Un espacio para pensar, definir y traquear ideas de aplicaciones.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Estado del sistema</CardTitle>
          <CardDescription>
            Andamiaje del hito H0. Todavía no hay producto: solo los cimientos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending && <p className="text-sm text-[var(--color-texto-suave)]">Consultando…</p>}
          {isError && (
            <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
              La API no responde. ¿Está arrancada en el puerto 3001?
            </p>
          )}
          {data && (
            <ul className="flex flex-col gap-2 text-sm">
              {Object.entries(data.checks).map(([nombre, check]) => (
                <li key={nombre} className="flex items-center gap-2">
                  <Indicador estado={check.status} />
                  <span className="font-medium">{nombre}</span>
                  <span className="text-[var(--color-texto-suave)]">
                    {check.status === 'up' ? `${String(check.latencyMs)} ms` : check.error}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
