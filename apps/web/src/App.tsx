import { useEffect, useState } from 'react';

import { Layout, type Pantalla } from './components/layout.js';
import { AppDetailPage } from './pages/app-detail.js';
import { AppsListPage } from './pages/apps-list.js';
import { LoginPage } from './pages/login.js';
import { WorkspaceActivityPage } from './pages/workspace-activity.js';
import { WorkspacePage } from './pages/workspace.js';
import { WorkspaceSettingsPage } from './pages/workspace-settings.js';
import { type AppFilters, useApps, useSession, useWorkspaces } from './lib/api.js';
import { AccountSettingsPage } from './pages/account.js';
import { AdminPage } from './pages/admin.js';
import { SearchDialog } from './components/search-dialog.js';
import { ShortcutsHelp } from './components/shortcuts-help.js';
import { useShortcuts } from './lib/shortcuts.js';

const WORKSPACE_KEY = 'app-foundry:workspace';
const FILTROS_KEY = 'app-foundry:filtros';

/**
 * Los filtros sobreviven a recargar.
 *
 * Quien acota una lista y vuelve mañana espera encontrarla como la dejó; y si no
 * fuera así, la propia barra de filtros diría que no hay nada puesto mientras la
 * lista aparece recortada, que es peor que no recordarlos.
 */
function filtrosGuardados(): AppFilters {
  try {
    const crudo = localStorage.getItem(FILTROS_KEY);
    return crudo ? (JSON.parse(crudo) as AppFilters) : {};
  } catch {
    return {};
  }
}

export function App() {
  const session = useSession();
  const workspaces = useWorkspaces(Boolean(session.data));
  const [selected, setSelected] = useState<string | null>(() =>
    localStorage.getItem(WORKSPACE_KEY),
  );
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [view, setView] = useState<'apps' | 'settings' | 'people' | 'activity'>('apps');
  /*
   * Qué se está mirando. La administración de la instancia y los ajustes de la
   * cuenta no pertenecen a ningún workspace, así que no son una pestaña más:
   * son otra pantalla.
   */
  const [pantalla, setPantalla] = useState<Pantalla>('workspace');
  /** Hilo al que hay que ir tras abrir una app desde un aviso (RF-904). */
  const [hiloDestino, setHiloDestino] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<AppFilters>(filtrosGuardados);
  const [buscando, setBuscando] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [crearApp, setCrearApp] = useState(0);

  useShortcuts([
    {
      tecla: 'k',
      conModificador: true,
      aunEscribiendo: true,
      hacer: () => {
        setBuscando(true);
      },
    },
    // «/» es lo que usa media web para buscar, y no hace falta modificador.
    {
      tecla: '/',
      hacer: () => {
        setBuscando(true);
      },
    },
    {
      tecla: 'n',
      hacer: () => {
        setOpenApp(null);
        setView('apps');
        setCrearApp((v) => v + 1);
      },
    },
    {
      tecla: '?',
      hacer: () => {
        setAyuda((v) => !v);
      },
    },
  ]);
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
        setPantalla('workspace');
        setSelected(id);
        // Cambiar de workspace cierra la app abierta: pertenece al anterior.
        setOpenApp(null);
        localStorage.setItem(WORKSPACE_KEY, id);
      }}
      apps={apps.data?.items ?? []}
      currentApp={openApp ? apps.data?.items.find((a) => a.id === openApp) : undefined}
      onSelectApp={(id) => {
        setPantalla('workspace');
        setHiloDestino(null);
        setOpenApp(id);
      }}
      pantalla={pantalla}
      onPantalla={setPantalla}
      onOpenNotification={(destino) => {
        // Un aviso siempre lleva a trabajo, nunca deja en una pantalla de ajustes.
        setPantalla('workspace');
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
      {pantalla === 'admin' && <AdminPage />}
      {pantalla === 'account' && (
        <AccountSettingsPage
          session={session.data}
          onBack={() => {
            setPantalla('workspace');
          }}
        />
      )}

      {pantalla === 'workspace' && !current && <Screen text="Preparing your workspace…" />}

      {pantalla === 'workspace' && current && openApp && (
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

      {pantalla === 'workspace' && current && !openApp && (
        <div className="flex flex-col gap-6">
          <nav className="flex gap-4 text-sm">
            {(
              [
                'apps',
                'settings',
                'people',
                ...(current.role === 'OWNER' ? (['activity'] as const) : []),
              ] as const
            ).map((v) => (
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
                {v === 'apps'
                  ? 'Apps'
                  : v === 'settings'
                    ? 'Settings'
                    : v === 'people'
                      ? 'People & invitations'
                      : 'Activity'}
              </button>
            ))}
          </nav>

          {view === 'apps' && (
            <AppsListPage
              workspace={current}
              filtros={filtros}
              crearAhora={crearApp}
              onFiltros={(siguiente) => {
                setFiltros(siguiente);
                localStorage.setItem(FILTROS_KEY, JSON.stringify(siguiente));
              }}
              onOpen={setOpenApp}
            />
          )}
          {view === 'settings' && <WorkspaceSettingsPage workspace={current} />}
          {view === 'people' && <WorkspacePage workspace={current} />}
          {view === 'activity' && <WorkspaceActivityPage workspace={current} />}
        </div>
      )}
      {buscando && (
        <SearchDialog
          onClose={() => {
            setBuscando(false);
          }}
          onOpen={(hit) => {
            setBuscando(false);
            if (hit.workspaceId !== selected) {
              setSelected(hit.workspaceId);
              localStorage.setItem(WORKSPACE_KEY, hit.workspaceId);
            }
            setHiloDestino(null);
            setOpenApp(hit.id);
          }}
        />
      )}

      {ayuda && (
        <ShortcutsHelp
          onClose={() => {
            setAyuda(false);
          }}
        />
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
