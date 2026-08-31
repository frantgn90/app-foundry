import { useState } from 'react';

import type { MentionableUser, OpenElsewhere, Thread } from '../lib/api.js';
import { CommentThread } from './comment-thread.js';
import { MentionInput } from './mention-input.js';
import { Button } from './ui/button.js';

interface Props {
  /** Pliega el panel hacia la derecha. */
  onCollapse: () => void;
  threads: Thread[];
  /** Conversaciones vivas que se quedaron en otras versiones (RF-817). */
  openElsewhere: OpenElsewhere[];
  /** Número de la versión que se está mirando; `null` si es la copia de trabajo. */
  versionMirada: number | null;
  onIrAVersion: (versionId: string) => void;
  people: MentionableUser[];
  selectedId: string | null;
  onSelect: (threadId: string | null) => void;
  onNewGeneral: (body: string) => void;
  onReply: (threadId: string, body: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onDeleteThread: (threadId: string) => void;
  onDeleteComment: (commentId: string) => void;
}

/**
 * Panel lateral con toda la conversación (RF-810).
 *
 * Los resueltos se ocultan por defecto pero no desaparecen: una discusión
 * cerrada sigue explicando por qué el documento dice lo que dice. Los huérfanos
 * se quedan a la vista con su cita, que es lo único que los hace recuperables.
 */
export function CommentsPanel({
  onCollapse,
  threads,
  openElsewhere,
  versionMirada,
  onIrAVersion,
  people,
  selectedId,
  onSelect,
  onNewGeneral,
  onReply,
  onResolve,
  onDeleteThread,
  onDeleteComment,
}: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);

  const open = threads.filter((t) => t.status === 'OPEN');
  const resolved = threads.filter((t) => t.status === 'RESOLVED');
  const visible = showResolved ? threads : open;

  function post() {
    if (!draft.trim()) return;
    onNewGeneral(draft.trim());
    setDraft('');
    setComposing(false);
  }

  return (
    <aside className="flex flex-col gap-3">
      {/* Altura fija, la misma que la fila de controles de la otra columna: es
          lo que hace que la caja del documento y el primer comentario empiecen
          a la misma altura. */}
      <header className="flex h-8 items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-medium">
          Conversation
          {open.length > 0 && (
            <span className="ml-1.5 text-[var(--color-texto-suave)]">({open.length})</span>
          )}
          {/* Mirando una versión pasada se dice de quién es esta conversación:
              si no, parecería que la de hoy se ha vaciado. */}
          {versionMirada !== null && (
            <span className="ml-1.5 font-normal text-[var(--color-texto-suave)]">
              on v{versionMirada}
            </span>
          )}
        </h2>
        <span className="flex items-center gap-1">
          {resolved.length > 0 && (
            <Button
              variant="ghost"
              className="px-2 py-1 text-sm"
              onClick={() => {
                setShowResolved((v) => !v);
              }}
            >
              {showResolved ? 'Hide resolved' : `Show resolved (${String(resolved.length)})`}
            </Button>
          )}

          <button
            onClick={onCollapse}
            title="Hide conversation"
            aria-label="Hide conversation"
            className="grid size-6 place-items-center rounded text-[var(--color-texto-suave)] hover:bg-[var(--color-borde)]/40 hover:text-[var(--color-texto)]"
          >
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
              <path d="M6 4l4 4-4 4" />
              <path d="M13 3v10" />
            </svg>
          </button>
        </span>
      </header>

      {visible.length === 0 && (
        <p className="text-xs text-[var(--color-texto-suave)]">
          {versionMirada !== null
            ? 'Nothing was commented on this version. You can only comment on the current one.'
            : 'Nothing yet. Select any text in the document to comment on it, or leave a general note below.'}
        </p>
      )}

      {/*
        Los hilos se quedan en la versión sobre la que se escribieron (RF-817),
        así que al commitear salen de la vista. Los que siguen abiertos se
        anuncian aquí con el camino de vuelta: una conversación viva que nadie ve
        es una conversación perdida.
      */}
      {openElsewhere.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-borde)] bg-[var(--color-superficie)] p-2">
          <p className="text-xs text-[var(--color-texto-suave)]">Still open on earlier versions:</p>
          <span className="flex flex-wrap gap-1.5">
            {openElsewhere.map((v) => (
              <button
                key={v.versionId}
                onClick={() => {
                  onIrAVersion(v.versionId);
                }}
                className="rounded-full border border-[var(--color-borde)] px-2 py-0.5 text-xs text-[var(--color-texto-suave)] transition hover:border-[var(--color-texto-suave)] hover:text-[var(--color-texto)]"
              >
                v{v.versionNo} ({v.openThreads})
              </button>
            ))}
          </span>
        </div>
      )}

      {/*
        Sin altura fija: el panel crece con la conversación y es la página la que
        hace scroll, en lugar de un recuadro con scroll propio dentro de otro que
        también lo tiene.
      */}
      <div className="flex flex-col gap-2">
        {visible.map((thread) => (
          <CommentThread
            key={thread.id}
            thread={thread}
            people={people}
            isSelected={thread.id === selectedId}
            onSelect={() => {
              onSelect(thread.id === selectedId ? null : thread.id);
            }}
            onReply={(body) => {
              onReply(thread.id, body);
            }}
            onResolve={(resolvedNow) => {
              onResolve(thread.id, resolvedNow);
            }}
            onDelete={() => {
              onDeleteThread(thread.id);
            }}
            onDeleteComment={onDeleteComment}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--color-borde)] pt-3">
        {composing ? (
          <>
            <MentionInput
              value={draft}
              onChange={setDraft}
              onSubmit={post}
              people={people}
              placeholder="Leave a general comment…"
              autoFocus
            />
            <div className="flex gap-2">
              <Button onClick={post} disabled={!draft.trim()}>
                Comment
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setComposing(false);
                  setDraft('');
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setComposing(true);
            }}
          >
            Add a general comment
          </Button>
        )}
      </div>
    </aside>
  );
}
