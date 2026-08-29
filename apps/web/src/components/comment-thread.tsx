import { useState } from 'react';

import type { Comment, MentionableUser, Thread } from '../lib/api.js';
import { MentionInput } from './mention-input.js';
import { Avatar } from './ui/avatar.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { cn } from '../lib/utils.js';

interface Props {
  thread: Thread;
  people: MentionableUser[];
  isSelected: boolean;
  onSelect: () => void;
  onReply: (body: string) => void;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onDeleteComment: (commentId: string) => void;
}

export function CommentThread({
  thread,
  people,
  isSelected,
  onSelect,
  onReply,
  onResolve,
  onDelete,
  onDeleteComment,
}: Props) {
  const [draft, setDraft] = useState('');
  // El campo de respuesta ocupa dos líneas en cada hilo y casi nunca se usa a la
  // vez en todos. Aparece bajo demanda para que quepan más hilos sin scroll.
  const [replying, setReplying] = useState(false);
  const isOrphan = thread.anchorStatus === 'ORPHANED';

  function send() {
    if (!draft.trim()) return;
    onReply(draft.trim());
    setDraft('');
    setReplying(false);
  }

  return (
    <article
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3 transition',
        isSelected
          ? 'border-[var(--color-acento)] bg-[var(--color-superficie)]'
          : 'border-[var(--color-borde)] hover:border-[var(--color-acento)]/40',
        thread.status === 'RESOLVED' && 'opacity-70',
      )}
    >
      {thread.kind === 'INLINE' && thread.anchorQuote && (
        <div className="flex flex-col gap-1">
          {/*
            La cita se enseña siempre, no solo cuando el ancla está viva. En un
            hilo huérfano es lo único que explica de qué se estaba hablando.
          */}
          <blockquote
            className={cn(
              'border-l-2 pl-2 text-xs italic',
              isOrphan
                ? 'border-[var(--color-fallo)]/50 text-[var(--color-texto-suave)] line-through'
                : 'border-[var(--color-acento)]/50 text-[var(--color-texto-suave)]',
            )}
          >
            {thread.anchorQuote}
          </blockquote>
          {isOrphan && (
            <span className="text-xs" style={{ color: 'var(--color-fallo)' }}>
              This text is no longer in the document
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {thread.comments.map((comment) => (
          <CommentBody
            key={comment.id}
            comment={comment}
            onDelete={() => {
              onDeleteComment(comment.id);
            }}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {thread.status === 'OPEN' && !replying && (
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => {
              setReplying(true);
            }}
          >
            Reply
          </Button>
        )}
        {thread.status === 'RESOLVED' ? (
          <>
            <Badge tone="ok">
              Resolved{thread.resolvedByHandle ? ` by @${thread.resolvedByHandle}` : ''}
            </Badge>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => {
                onResolve(false);
              }}
            >
              Reopen
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => {
              onResolve(true);
            }}
          >
            Resolve
          </Button>
        )}
        {thread.canDelete && (
          <Button variant="danger" className="ml-auto px-2 py-1 text-xs" onClick={onDelete}>
            Delete thread
          </Button>
        )}
      </div>

      {thread.status === 'OPEN' && replying && (
        <div className="flex flex-col gap-2">
          <MentionInput
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            people={people}
            placeholder="Reply…"
            autoFocus
          />
          <div className="flex gap-2">
            <Button className="px-2 py-1 text-xs" onClick={send} disabled={!draft.trim()}>
              Send
            </Button>
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => {
                setReplying(false);
                setDraft('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function CommentBody({ comment, onDelete }: { comment: Comment; onDelete: () => void }) {
  if (comment.isDeleted) {
    // Se deja constancia de que hubo algo: borrar del todo dejaría una
    // conversación con saltos que no se entienden.
    return (
      <p className="text-xs italic text-[var(--color-texto-suave)]">
        @{comment.authorHandle} deleted a comment
      </p>
    );
  }

  return (
    <div className={cn('flex gap-2', comment.parentId && 'ml-5')}>
      <Avatar src={comment.authorAvatarUrl} name={comment.authorDisplayName} className="size-6" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium">@{comment.authorHandle}</span>
          <span className="text-xs text-[var(--color-texto-suave)]">
            {new Date(comment.createdAt).toLocaleDateString()}
            {comment.isEdited && ' · edited'}
          </span>
          {comment.isMine && (
            <button
              onClick={onDelete}
              className="ml-auto text-xs text-[var(--color-texto-suave)] hover:underline"
            >
              Delete
            </button>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm">{highlightMentions(comment.body)}</p>
      </div>
    </div>
  );
}

/** Resalta los `@handle` para que se vean como lo que son. */
function highlightMentions(body: string) {
  return body.split(/(@[A-Za-z\d-]+)/g).map((part, index) =>
    part.startsWith('@') ? (
      <strong key={index} style={{ color: 'var(--color-acento)' }}>
        {part}
      </strong>
    ) : (
      part
    ),
  );
}
