import { useEffect, useMemo, useRef, useState } from 'react';

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
import { VisionControls } from '../components/vision-controls.js';
import { Markdown } from '../components/markdown.js';
import { StatusPill, TagList, VisibilityMark } from '../components/app-status.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { useShortcuts } from '../lib/shortcuts.js';
import { cn } from '../lib/utils.js';

type Tab = 'vision' | 'history' | 'settings';

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

  const [tab, setTab] = useState<Tab>('vision');
  /*
   * Leer y escribir dejan de ser sitios distintos y pasan a ser un interruptor
   * sobre el mismo documento: se puede pasar de uno a otro sin perder de vista
   * dónde se estaba. Leer muestra el texto compuesto; escribir, el markdown.
   */
  const [editando, setEditando] = useState(false);
  /*
   * La conversación se puede plegar hacia la derecha. Escribir a media pantalla
   * incomoda, y hay ratos en que la conversación no hace falta delante; el
   * contador en el botón evita que se olvide que sigue ahí.
   */
  const [conversacionAbierta, setConversacionAbierta] = useState(true);
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
    setTab('vision');
  }, [initialThreadId]);

  // La selección pendiente se guarda al soltar el ratón, pero el formulario no
  // se abre hasta que se pulsa el botón del menú: seleccionar texto no es
  // decidir comentarlo.
  const [pendingSelection, setPendingSelection] = useState<SourceSelection | null>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState('');
  const readingRef = useRef<HTMLDivElement>(null);

  /*
   * Guardar con el teclado vale en toda la pestaña, no solo con el foco dentro
   * del editor: si no, hacer clic fuera y pulsar Mod-S abriría el diálogo de
   * guardar página del navegador, que no es lo que nadie quiere ahí.
   *
   * Va aquí arriba, con el resto de hooks y antes de cualquier salida
   * anticipada: más abajo, el primer render —el de «cargando»— tendría menos
   * hooks que el siguiente y React abortaría el componente entero. Se ve solo al
   * abrir una app que no esté ya en memoria, que es justo lo que no se prueba
   * abriendo dos veces la misma.
   */
  const guardarConTeclado = useRef<() => void>(() => undefined);
  useShortcuts(
    useMemo(
      () => [
        {
          tecla: 's',
          conModificador: true,
          aunEscribiendo: true,
          hacer: () => {
            guardarConTeclado.current();
          },
        },
      ],
      [],
    ),
  );

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
  }, [
    anchorsKey,
    selectedThread,
    pendingSelection,
    tab,
    editando,
    scrollToThread,
    document.data?.content,
  ]);

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
    // Si había borrador sin guardar, se vuelve a donde se estaba escribiendo.
    if (saved && saved !== document.data.content) setEditando(true);
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

  guardarConTeclado.current = () => {
    if (editando) onSave();
  };

  function onSave() {
    if (!document.data) return;
    setConflict(null);
    save.mutate(
      { content, baseVersionId: document.data.currentVersionId ?? '' },
      {
        onSuccess: () => {
          localStorage.removeItem(draftKey(appId));
          setTab('vision');
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

      {/*
        Todo en una línea, con las etiquetas debajo.
        
        Los metadatos —versión, quién la empezó, cuántos comentarios hay
        abiertos— son referencia, no titular: valen para orientarse al llegar y
        después se ignoran. En su propia línea ocupaban alto de pantalla que le
        hace más falta al documento, que es a lo que se viene.
      */}
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          {/* Misma altura de línea que el título, en lugar de empujarlo con un
              relleno a ojo: así se centra con él por construcción y sigue
              cuadrando si algún día cambia el tamaño del nombre. */}
          <span className="text-2xl leading-8" aria-hidden>
            {app.data.icon.emoji}
          </span>
          <div className="flex min-w-0 flex-col gap-1.5">
            {/*
              Centrados y no alineados por la línea base: con un título de
              veinticuatro píxeles al lado de un texto de doce, la base común
              deja lo pequeño cinco píxeles más abajo de su sitio. Se ve.
            */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{app.data.name}</h1>
              <span className="flex items-center gap-2.5">
                <StatusPill status={app.data.isArchived ? 'ARCHIVED' : app.data.status} />
                <VisibilityMark accessLevel={app.data.accessLevel} />
              </span>
              <span className="text-xs text-[var(--color-texto-suave)]">
                v{document.data.versionNo} · started by @{app.data.precursorHandle}
                {openThreads > 0 &&
                  ` · ${String(openThreads)} open comment${openThreads === 1 ? '' : 's'}`}
              </span>
            </div>
            <TagList tags={app.data.tags} />
          </div>
        </div>
      </header>

      <nav className="flex items-center gap-1 border-b border-[var(--color-borde)]">
        {(['vision', 'history', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
            }}
            className={cn(
              'relative px-3 py-2 text-sm',
              t === 'vision' ? '' : 'capitalize',
              tab === t
                ? 'font-medium text-[var(--color-texto)]'
                : 'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
            )}
          >
            {t === 'vision' ? 'VISION.md' : t}
            {t === 'vision' && hasUnsavedChanges && ' •'}
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

      {tab === 'vision' && (
        /*
         * Las dos vistas comparten la misma rejilla, así que la conversación
         * sigue al lado tanto si se mira el texto compuesto como el original.
         *
         * Las dos cabeceras —los controles a la izquierda, el título de la
         * conversación a la derecha— tienen la misma altura fija, de modo que lo
         * que va debajo empieza al mismo nivel en ambas columnas: el borde
         * superior de la caja y el del primer comentario coinciden.
         */
        <div
          className={cn(
            'grid gap-6',
            conversacionAbierta ? 'lg:grid-cols-[1fr_20rem]' : 'lg:grid-cols-1',
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="flex h-8 items-center justify-end gap-2">
              {/* Con la conversación plegada, su botón ocupa el sitio que deja:
                  es lo que impide que se olvide que hay comentarios. */}
              {!conversacionAbierta && (
                <button
                  onClick={() => {
                    setConversacionAbierta(true);
                  }}
                  title="Show conversation"
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                    'border-[var(--color-borde)] bg-[var(--color-superficie)]',
                    'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
                  )}
                >
                  <PanelIcono />
                  Conversation
                  {openThreads > 0 && <span>({openThreads})</span>}
                </button>
              )}

              <VisionControls
                editando={editando}
                puedeEditar={document.data.canEdit}
                onEditando={setEditando}
              />

              <a
                href={`/api/v1/apps/${appId}/document/export`}
                title="Download VISION.md"
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                  'border-[var(--color-borde)] bg-[var(--color-superficie)]',
                  'text-[var(--color-texto-suave)] hover:text-[var(--color-texto)]',
                )}
              >
                <Descarga />
                VISION.md
              </a>
            </div>

            {!editando ? (
              <>
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
                    // Mientras se escribe, lo que se ve es el borrador: comentar ahí
                    // anclaría el hilo a posiciones de un texto que no está guardado.
                    if (editando) return;

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
              </>
            ) : (
              /*
                El mismo editor se use para escribir o solo para mirar: con la
                edición apagada el texto se ve igual, con sus números de línea, y
                solo cambia que no admite teclas. Así pasar de leer a escribir no
                mueve nada de sitio.
              */
              <Card className="px-4">
                <MarkdownEditor
                  value={content}
                  onChange={setDraft}
                  onSave={onSave}
                  disabled={!editando}
                />
              </Card>
            )}
          </div>

          {conversacionAbierta && (
            <CommentsPanel
              onCollapse={() => {
                setConversacionAbierta(false);
              }}
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
          )}
        </div>
      )}

      {/* Guardar está mientras se escriba, se esté mirando el texto o el
          resultado: previsualizar no es dejar de editar. */}
      {tab === 'vision' && editando && (
        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={save.isPending || !hasUnsavedChanges}>
            {save.isPending ? 'Saving…' : 'Save version'}
          </Button>
          <span className="text-xs text-[var(--color-texto-suave)]">
            {hasUnsavedChanges ? 'Unsaved changes, kept locally' : 'Everything saved'} · ⌘S
          </span>
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
                              setTab('vision');
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

/** Flecha de despliegue: la conversación vuelve desde la derecha. */
function PanelIcono() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 4L6 8l4 4" />
      <path d="M13 3v10" />
    </svg>
  );
}

function Descarga() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2.5v7M5 7l3 3 3-3M3 12.5h10" />
    </svg>
  );
}
