import { useEffect, useState } from 'react';

import {
  ConflictError,
  type SaveConflict,
  useApp,
  useDocument,
  useRestoreVersion,
  useSaveDocument,
  useVersionContent,
  useVersions,
} from '../lib/api.js';
import { DiffView } from '../components/diff-view.js';
import { MarkdownEditor } from '../components/editor.js';
import { Markdown } from '../components/markdown.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { cn } from '../lib/utils.js';

type Tab = 'read' | 'edit' | 'history';

/** Clave del borrador local, por app: no se mezclan entre sí (RF-506). */
const draftKey = (appId: string) => `app-foundry:draft:${appId}`;

export function AppDetailPage({ appId, onBack }: { appId: string; onBack: () => void }) {
  const app = useApp(appId);
  const document = useDocument(appId);
  const versions = useVersions(appId);
  const save = useSaveDocument(appId);
  const restore = useRestoreVersion(appId);

  const [tab, setTab] = useState<Tab>('read');
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);

  const comparison = useVersionContent(appId, comparing);

  // Borrador local: cerrar la pestaña a media edición no debería perder el
  // texto. No genera versiones, solo sobrevive a un accidente (RF-506).
  useEffect(() => {
    if (draft === null || !document.data) return;
    if (draft === document.data.content) {
      localStorage.removeItem(draftKey(appId));
      return;
    }
    localStorage.setItem(draftKey(appId), draft);
  }, [draft, appId, document.data]);

  useEffect(() => {
    if (!document.data || draft !== null) return;
    const saved = localStorage.getItem(draftKey(appId));
    setDraft(saved ?? document.data.content);
    if (saved && saved !== document.data.content) setTab('edit');
  }, [document.data, draft, appId]);

  if (app.isPending || document.isPending) {
    return <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>;
  }
  if (!app.data || !document.data) {
    return <p className="text-sm">This app could not be loaded.</p>;
  }

  const content = draft ?? document.data.content;
  const hasUnsavedChanges = content !== document.data.content;

  function onSave() {
    if (!document.data) return;
    setConflict(null);
    save.mutate(
      { content, baseVersionId: document.data.currentVersionId ?? '' },
      {
        onSuccess: () => {
          localStorage.removeItem(draftKey(appId));
          setTab('read');
        },
        onError: (error) => {
          if (error instanceof ConflictError) setConflict(error.detail);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={onBack}
        className="self-start text-sm text-[var(--color-texto-suave)] hover:underline"
      >
        ← All apps
      </button>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden>
            {app.data.icon.emoji}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{app.data.name}</h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge>{app.data.status.replace('_', ' ').toLowerCase()}</Badge>
              {app.data.accessLevel === 'PRIVATE' && <Badge>private</Badge>}
              {app.data.isArchived && <Badge tone="warning">archived</Badge>}
              <span className="text-xs text-[var(--color-texto-suave)]">
                v{document.data.versionNo} · @{app.data.precursorHandle}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/v1/apps/${appId}/document/export`}
            className="text-sm text-[var(--color-texto-suave)] hover:underline"
          >
            Download VISION.md
          </a>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-[var(--color-borde)]">
        {(['read', 'edit', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
            }}
            disabled={t === 'edit' && !document.data?.canEdit}
            className={cn(
              'relative px-3 py-2 text-sm capitalize disabled:cursor-not-allowed disabled:opacity-40',
              tab === t
                ? 'font-medium text-[var(--color-texto)]'
                : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
            )}
          >
            {t}
            {t === 'edit' && hasUnsavedChanges && ' •'}
            {tab === t && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 bg-[var(--color-acento)]" />
            )}
          </button>
        ))}
      </nav>

      {conflict && (
        <ConflictNotice
          conflict={conflict}
          onDismiss={() => {
            setConflict(null);
          }}
        />
      )}

      {tab === 'read' && (
        <Card className="p-6">
          <Markdown content={document.data.content} />
        </Card>
      )}

      {tab === 'edit' && document.data.canEdit && (
        <div className="flex flex-col gap-3">
          <Card className="px-6">
            <MarkdownEditor value={content} onChange={setDraft} onSave={onSave} />
          </Card>
          <div className="flex items-center gap-3">
            <Button onClick={onSave} disabled={save.isPending || !hasUnsavedChanges}>
              {save.isPending ? 'Saving…' : 'Save version'}
            </Button>
            <span className="text-xs text-[var(--color-texto-suave)]">
              {hasUnsavedChanges ? 'Unsaved changes, kept locally' : 'Everything saved'} · ⌘S
            </span>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-[var(--color-borde)]">
                {versions.data?.map((version) => (
                  <li key={version.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        <span className="font-medium">v{version.versionNo}</span>{' '}
                        {version.message ?? '—'}
                      </span>
                      <span className="block text-xs text-[var(--color-texto-suave)]">
                        @{version.authorHandle} · {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => {
                        setComparing(comparing === version.id ? null : version.id);
                      }}
                    >
                      {comparing === version.id ? 'Hide changes' : 'Compare'}
                    </Button>
                    {document.data?.canEdit && version.id !== document.data.currentVersionId && (
                      <Button
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        disabled={restore.isPending}
                        onClick={() => {
                          restore.mutate(version.id, {
                            onSuccess: (updated) => {
                              setDraft(updated.content);
                              setTab('read');
                            },
                          });
                        }}
                      >
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {comparing && comparison.data && (
            <Card>
              <CardHeader>
                <CardTitle>
                  v{comparison.data.versionNo} compared with the current version
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DiffView from={comparison.data.content} to={document.data.content} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Aviso de conflicto (RF-511).
 *
 * No basta con decir que falló: se enseña quién guardó y qué hay ahora, porque
 * lo que la persona necesita decidir es si su texto sigue teniendo sentido
 * encima del de otro.
 */
function ConflictNotice({
  conflict,
  onDismiss,
}: {
  conflict: SaveConflict;
  onDismiss: () => void;
}) {
  return (
    <Card className="border-[var(--color-fallo)]/40 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium" style={{ color: 'var(--color-fallo)' }}>
              @{conflict.lastAuthorHandle} saved version {conflict.currentVersionNo} while you were
              writing
            </p>
            <p className="text-sm text-[var(--color-texto-suave)]">
              Nothing was overwritten. Below is what changed — copy over whatever still applies.
            </p>
          </div>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
        <details>
          <summary className="cursor-pointer text-sm">See the saved version</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-fondo)] p-3 text-xs">
            {conflict.currentContent}
          </pre>
        </details>
      </div>
    </Card>
  );
}
