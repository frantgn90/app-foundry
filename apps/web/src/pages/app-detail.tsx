import { useEffect, useRef, useState } from 'react';

import {
  ConflictError,
  type SaveConflict,
  useApp,
  useCreateThread,
  useDeleteComment,
  useDeleteThread,
  useDocument,
  useMentionable,
  useReply,
  useResolveThread,
  useRestoreVersion,
  useSaveDocument,
  useThreads,
  useVersionContent,
  useVersions,
} from '../lib/api.js';
import { CommentsPanel } from '../components/comments-panel.js';
import { type AnchorRange, paintAnchors, paintPending, sourceOffsetAt } from '../lib/highlight.js';
import { SelectionMenu } from '../components/selection-menu.js';
import { resolveSelection, type SourceSelection } from '../lib/selection.js';
import { MentionInput } from '../components/mention-input.js';
import { AppSettingsPage } from './app-settings.js';
import { DiffView } from '../components/diff-view.js';
import { MarkdownEditor } from '../components/editor.js';
import { Markdown } from '../components/markdown.js';
import { StatusPill, TagList, VisibilityMark } from '../components/app-status.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { cn } from '../lib/utils.js';

type Tab = 'read' | 'edit' | 'history' | 'settings';

/** Clave del borrador local, por app: no se mezclan entre sí (RF-506). */
const draftKey = (appId: string) => `app-foundry:draft:${appId}`;

export function AppDetailPage({
  appId,
  workspaceId,
  initialThreadId = null,
  onBack,
}: {
  appId: string;
  workspaceId: string;
  /** Hilo al que ir nada más abrir, cuando se llega desde un aviso (RF-904). */
  initialThreadId?: string | null;
  onBack: () => void;
}) {
  const app = useApp(appId);
  const document = useDocument(appId);
  const versions = useVersions(appId);
  const save = useSaveDocument(appId);
  const restore = useRestoreVersion(appId);

  const [tab, setTab] = useState<Tab>('read');
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(initialThreadId);
  // Solo se hace scroll cuando el hilo se elige desde el panel; al pinchar en el
  // texto ya se está mirando el sitio.
  const [scrollToThread, setScrollToThread] = useState(initialThreadId !== null);
  /*
   * Llegar desde un aviso a una app que ya estaba abierta también tiene que
   * llevar al hilo: sin esto, el segundo aviso de la misma app no movería nada,
   * porque el estado inicial ya se fijó al montar.
   */
  useEffect(() => {
    if (initialThreadId === null) return;
    setSelectedThread(initialThreadId);
    setScrollToThread(true);
    setTab('read');
  }, [initialThreadId]);

  // La selección pendiente se guarda al soltar el ratón, pero el formulario no
  // se abre hasta que se pulsa el botón del menú: seleccionar texto no es
  // decidir comentarlo.
  const [pendingSelection, setPendingSelection] = useState<SourceSelection | null>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState('');
  const readingRef = useRef<HTMLDivElement>(null);

  const comparison = useVersionContent(appId, comparing);
  const threads = useThreads(appId);
  const people = useMentionable(appId);
  const createThread = useCreateThread(appId);
  const reply = useReply(appId);
  const resolveThread = useResolveThread(appId);
  const deleteThread = useDeleteThread(appId);
  const deleteComment = useDeleteComment(appId);

  // Al elegir un hilo se resalta su fragmento en el documento y se lleva a la
  // vista: es la mitad de la navegación entre panel y texto (RF-810).
  /*
   * Todos los fragmentos con conversación abierta se pintan, no solo el elegido:
   * si no, la conversación existente sería invisible hasta abrir el panel
   * (RF-810).
   *
   * Los hilos resueltos se quedan fuera a propósito. Se resuelven precisamente
   * porque ya no hay nada que hacer con ellos, y son la parte de la lista que
   * crece sin parar: un documento con meses de historia acabaría subrayado de
   * punta a punta y el resaltado dejaría de señalar nada. Siguen en el panel, y
   * reabrir uno lo devuelve al documento.
   */
  const anchorRanges: AnchorRange[] = (threads.data ?? [])
    .filter(
      (t) =>
        t.status === 'OPEN' &&
        t.anchorStatus === 'ANCHORED' &&
        t.anchorStart !== null &&
        t.anchorEnd !== null,
    )
    .map((t) => ({ threadId: t.id, start: t.anchorStart ?? 0, end: t.anchorEnd ?? 0 }));

  const anchorsKey = anchorRanges.map((a) => `${a.threadId}:${String(a.start)}`).join('|');

  /*
   * Todo el resaltado se pinta de una vez y en el mismo efecto.
   *
   * Los rangos de la Custom Highlight API apuntan a nodos concretos del DOM, así
   * que cualquier cosa que rehaga el documento los deja apuntando a nodos que ya
   * no están: el resaltado sigue registrado pero no pinta nada, y no salta
   * ningún error. Intentar cubrirlo enumerando dependencias no funcionó —
   * siempre aparecía otra cosa que rehacía el documento sin cambiar ninguna de
   * ellas, como desplegar los hilos resueltos en el panel de al lado.
   *
   * Así que en vez de adivinar qué provoca el re-render, se observa el resultado
   * y se repinta. Resaltar no modifica el DOM (de eso trata precisamente esta
   * API), así que el observador no puede dispararse a sí mismo.
   */
  useEffect(() => {
    const contenedor = readingRef.current;

    const pintar = () => {
      paintAnchors(contenedor, anchorRanges, selectedThread, {
        scrollToActive: scrollToThread,
      });
      paintPending(contenedor, pendingSelection);
    };

    pintar();
    if (scrollToThread) setScrollToThread(false);

    if (!contenedor) return;
    // El scroll solo se hace en el pintado inicial: repetirlo en cada mutación
    // movería la página bajo los pies de quien está leyendo.
    const observador = new MutationObserver(() => {
      paintAnchors(contenedor, anchorRanges, selectedThread, { scrollToActive: false });
      paintPending(contenedor, pendingSelection);
    });
    observador.observe(contenedor, { childList: true, subtree: true, characterData: true });
    return () => {
      observador.disconnect();
    };
    // `anchorsKey` resume la lista de anclas, que se reconstruye en cada render.
  }, [anchorsKey, selectedThread, pendingSelection, tab, scrollToThread, document.data?.content]);

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
  const openThreads = (threads.data ?? []).filter((t) => t.status === 'OPEN').length;
  const hasUnsavedChanges = content !== document.data.content;

  function postInlineComment() {
    if (!pendingSelection || !selectionDraft.trim()) return;
    createThread.mutate(
      {
        body: selectionDraft.trim(),
        quote: pendingSelection.quote,
        start: pendingSelection.start,
        end: pendingSelection.end,
      },
      {
        onSuccess: () => {
          setPendingSelection(null);
          setSelectionDraft('');
          setComposing(false);
        },
      },
    );
  }

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
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{app.data.name}</h1>
              <StatusPill status={app.data.isArchived ? 'ARCHIVED' : app.data.status} />
              <VisibilityMark accessLevel={app.data.accessLevel} />
            </div>
            <TagList tags={app.data.tags} />
            <span className="text-xs text-[var(--color-texto-suave)]">
              v{document.data.versionNo} · started by @{app.data.precursorHandle}
              {openThreads > 0 &&
                ` · ${String(openThreads)} open comment${openThreads === 1 ? '' : 's'}`}
            </span>
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
        {(['read', 'edit', 'history', 'settings'] as const).map((t) => (
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
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-3">
            {/*
              Al soltar el ratón se mira si hay una selección utilizable. Si no
              se puede resolver a una posición del markdown, no se ofrece
              comentar: mejor no ofrecerlo que anclar en un sitio inventado.
            */}
            <Card
              className="p-6"
              ref={readingRef}
              onMouseUp={(event) => {
                if (!document.data || !readingRef.current) return;

                const selection = resolveSelection(document.data.content, readingRef.current);
                if (selection) {
                  setPendingSelection(selection);
                  setMenuAt({ top: event.clientY, left: event.clientX });
                  return;
                }

                // Sin selección, un clic sobre un fragmento comentado lleva a su
                // hilo: es el camino inverso al del resaltado.
                setPendingSelection(null);
                setMenuAt(null);
                const offset = sourceOffsetAt(readingRef.current, event.clientX, event.clientY);
                const hit =
                  offset === null
                    ? undefined
                    : anchorRanges.find((a) => offset >= a.start && offset <= a.end);
                if (hit) setSelectedThread(hit.threadId);
              }}
            >
              <Markdown content={document.data.content} />
            </Card>

            {menuAt && pendingSelection && !composing && (
              <SelectionMenu
                position={menuAt}
                onComment={() => {
                  setComposing(true);
                  setMenuAt(null);
                }}
              />
            )}

            {composing && pendingSelection && (
              <Card className="flex flex-col gap-2 border-[var(--color-acento)]/40 p-4">
                <p className="text-xs text-[var(--color-texto-suave)]">Commenting on:</p>
                <blockquote className="border-l-2 border-[var(--color-acento)]/50 pl-2 text-sm italic">
                  {pendingSelection.quote}
                </blockquote>
                <MentionInput
                  value={selectionDraft}
                  onChange={setSelectionDraft}
                  onSubmit={() => {
                    postInlineComment();
                  }}
                  people={people.data ?? []}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button onClick={postInlineComment} disabled={!selectionDraft.trim()}>
                    Comment
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPendingSelection(null);
                      setSelectionDraft('');
                      setComposing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </Card>
            )}
          </div>

          <CommentsPanel
            threads={threads.data ?? []}
            people={people.data ?? []}
            selectedId={selectedThread}
            onSelect={(id) => {
              setSelectedThread(id);
              setScrollToThread(id !== null);
            }}
            onNewGeneral={(body) => {
              createThread.mutate({ body });
            }}
            onReply={(threadId, body) => {
              reply.mutate({ threadId, body });
            }}
            onResolve={(threadId, resolved) => {
              resolveThread.mutate({ threadId, resolved });
            }}
            onDeleteThread={(threadId) => {
              deleteThread.mutate(threadId);
            }}
            onDeleteComment={(commentId) => {
              deleteComment.mutate(commentId);
            }}
          />
        </div>
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

      {tab === 'settings' && (
        <AppSettingsPage app={app.data} workspaceId={workspaceId} onDeleted={onBack} />
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
