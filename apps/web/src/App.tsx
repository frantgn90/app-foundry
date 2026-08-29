import { useEffect, useState } from 'react';

import { Layout } from './components/layout.js';
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
        localStorage.setItem(WORKSPACE_KEY, id);
      }}
    >
      {current ? (
        <WorkspacePage workspace={current} />
      ) : (
        <Screen text="Preparing your workspace…" />
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
