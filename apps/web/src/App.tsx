import { useEffect, useState } from 'react';

import { Layout } from './components/layout.js';
import { AppDetailPage } from './pages/app-detail.js';
import { AppsListPage } from './pages/apps-list.js';
import { LoginPage } from './pages/login.js';
import { WorkspacePage } from './pages/workspace.js';
import { useSession, useWorkspaces } from './lib/api.js';

const WORKSPACE_KEY = 'app-foundry:workspace';

export function App() {
  const session = useSession();
  const workspaces = useWorkspaces(Boolean(session.data));
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem(WORKSPACE_KEY),
  );
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [view, setView] = useState<'apps' | 'people'>('apps');

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
    >
      {!current && <Screen text="Preparing your workspace…" />}

      {current && openApp && (
        <AppDetailPage
          appId={openApp}
          workspaceId={current.id}
          onBack={() => {
            setOpenApp(null);
          }}
        />
      )}

      {current && !openApp && (
        <div className="flex flex-col gap-6">
          <nav className="flex gap-4 text-sm">
            {(['apps', 'people'] as const).map((v) => (
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
                {v === 'apps' ? 'Apps' : 'People & invitations'}
              </button>
            ))}
          </nav>

          {view === 'apps' ? (
            <AppsListPage workspace={current} onOpen={setOpenApp} />
          ) : (
            <WorkspacePage workspace={current} />
          )}
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
