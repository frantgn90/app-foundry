import { useEffect, useState } from 'react';

import { Layout } from './components/layout.js';
import { AppDetailPage } from './pages/app-detail.js';
import { AppsListPage } from './pages/apps-list.js';
import { LoginPage } from './pages/login.js';
import { WorkspacePage } from './pages/workspace.js';
import { WorkspaceSettingsPage } from './pages/workspace-settings.js';
import { useApps, useSession, useWorkspaces } from './lib/api.js';

const WORKSPACE_KEY = 'app-foundry:workspace';

export function App() {
  const session = useSession();
  const workspaces = useWorkspaces(Boolean(session.data));
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem(WORKSPACE_KEY),
  );
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [view, setView] = useState<'apps' | 'settings' | 'people'>('apps');
  /** Hilo al que hay que ir tras abrir una app desde un aviso (RF-904). */
  const [hiloDestino, setHiloDestino] = useState<string | null>(null);
  // Misma clave que usa el listado, así que TanStack Query la comparte y no
  // hay una segunda petición por tener el desplegable en la cabecera.
  const apps = useApps(selected ?? undefined);

  // Al entrar se aterriza en el workspace personal (RF-301), salvo que ya
  // estuvieras en otro la última vez.
  useEffect(() => {
    if (!workspaces.data || workspaces.data.length === 0) return;
    const exists = workspaces.data.some((w) => w.id === selected);
    if (!exists) {
      const personalWorkspace = workspaces.data.find((w) => w.isPersonal) ?? workspaces.data[0];
      if (personalWorkspace) setSelected(personalWorkspace.id);
    }
  }, [workspaces.data, selected]);

  if (session.isPending) {
    return <Screen text="Loading…" />;
  }

  // Sin sesión no hay nada que enseñar salvo la puerta.
  if (!session.data) {
    return <LoginPage />;
  }

  if (workspaces.isError) {
    return <Screen text="Something went wrong loading your workspaces." error />;
  }

  const current = workspaces.data?.find((w) => w.id === selected);

  return (
    <Layout
      session={session.data}
      workspaces={workspaces.data ?? []}
      current={current}
      onSelect={(id) => {
        setSelected(id);
        // Cambiar de workspace cierra la app abierta: pertenece al anterior.
        setOpenApp(null);
        localStorage.setItem(WORKSPACE_KEY, id);
      }}
      apps={apps.data ?? []}
      currentApp={openApp ? apps.data?.find((a) => a.id === openApp) : undefined}
      onSelectApp={(id) => {
        setHiloDestino(null);
        setOpenApp(id);
      }}
      onOpenNotification={(destino) => {
        /*
         * Un aviso lleva al sitio exacto, no a la puerta (RF-904). Si es de otro
         * workspace hay que cambiar primero, porque una app solo existe dentro
         * del suyo.
         */
        if (destino.workspaceId !== selected) {
          setSelected(destino.workspaceId);
          localStorage.setItem(WORKSPACE_KEY, destino.workspaceId);
        }
        setHiloDestino(destino.threadId);
        setOpenApp(destino.appId);
        // Sin app, el aviso es del workspace: se aterriza en su gente.
        if (!destino.appId) setView(destino.threadId ? 'apps' : 'people');
      }}
    >
      {!current && <Screen text="Preparing your workspace…" />}

      {current && openApp && (
        <AppDetailPage
          appId={openApp}
          workspaceId={current.id}
          initialThreadId={hiloDestino}
          onBack={() => {
            setHiloDestino(null);
            setOpenApp(null);
          }}
        />
      )}

      {current && !openApp && (
        <div className="flex flex-col gap-6">
          <nav className="flex gap-4 text-sm">
            {(['apps', 'settings', 'people'] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setView(v);
                }}
                className={
                  view === v
                    ? 'font-medium'
                    : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]'
                }
              >
                {v === 'apps' ? 'Apps' : v === 'settings' ? 'Settings' : 'People & invitations'}
              </button>
            ))}
          </nav>

          {view === 'apps' && <AppsListPage workspace={current} onOpen={setOpenApp} />}
          {view === 'settings' && <WorkspaceSettingsPage workspace={current} />}
          {view === 'people' && <WorkspacePage workspace={current} />}
        </div>
      )}
    </Layout>
  );
}

function Screen({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <p
        className="text-sm"
        style={{ color: error ? 'var(--color-fallo)' : 'var(--color-texto-suave)' }}
      >
        {text}
      </p>
    </div>
  );
}
