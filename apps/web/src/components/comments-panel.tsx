import { useState } from 'react';

import type { MentionableUser, Thread } from '../lib/api.js';
import { CommentThread } from './comment-thread.js';
import { MentionInput } from './mention-input.js';
import { Button } from './ui/button.js';

interface Props {
  /** Pliega el panel hacia la derecha. */
  onCollapse: () => void;
  threads: Thread[];
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
        <h2 className="text-sm font-medium">
          Conversation
          {open.length > 0 && (
            <span className="ml-1.5 text-[var(--color-texto-suave)]">({open.length})</span>
          )}
        </h2>
        <span className="flex items-center gap-1">
          {resolved.length > 0 && (
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
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
          Nothing yet. Select any text in the document to comment on it, or leave a general note
          below.
        </p>
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
