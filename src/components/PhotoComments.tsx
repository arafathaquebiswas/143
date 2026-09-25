'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { CloseIcon, HeartIcon, TrashIcon } from '@/components/icons';
import {
  addCommentAction,
  deleteCommentAction,
  editCommentAction,
} from '@/lib/actions';
import type { PhotoComment } from '@/lib/types';
import { cn } from '@/lib/utils';

/** "just now", "14m", "3h", "2d", then a date. */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function PhotoComments({
  photoId,
  comments,
  onChange,
}: {
  photoId: string;
  comments: PhotoComment[];
  /** Hands the new list back up so the gallery keeps it after the viewer closes. */
  onChange: (next: PhotoComment[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [pending, start] = useTransition();

  const listEnd = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Collapse again when the viewer moves to another photo.
  useEffect(() => {
    setOpen(false);
    setEditingId(null);
    setError(null);
  }, [photoId]);

  useEffect(() => {
    if (open) listEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [open, comments.length]);

  const post = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);

    start(async () => {
      const result = await addCommentAction(photoId, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.comment) onChange([...comments, result.comment]);
      setDraft('');
      inputRef.current?.focus();
    });
  };

  const saveEdit = (id: string) => {
    const text = editDraft.trim();
    if (!text) return;
    setError(null);

    start(async () => {
      const result = await editCommentAction(id, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(comments.map((c) => (c.id === id ? { ...c, body: text } : c)));
      setEditingId(null);
    });
  };

  const remove = (id: string) => {
    setError(null);
    start(async () => {
      const result = await deleteCommentAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(comments.filter((c) => c.id !== id));
    });
  };

  const field =
    'w-full resize-none rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-3 text-base text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none sm:text-sm';

  return (
    <div className="mt-3.5 border-t border-white/10 pt-3.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white/75 backdrop-blur-xl transition-all duration-300 hover:bg-white/15 hover:text-white"
      >
        <HeartIcon filled width={12} height={12} />
        {comments.length === 0
          ? 'Leave a note'
          : `${comments.length} ${comments.length === 1 ? 'note' : 'notes'}`}
        <span
          className={cn(
            'text-white/40 transition-transform duration-300',
            open && 'rotate-180',
          )}
          aria-hidden
        >
          &#9662;
        </span>
      </button>

      {open && (
        <div className="animate-fade mt-3.5 space-y-3">
          {comments.length > 0 && (
            <ul className="max-h-48 space-y-2.5 overflow-y-auto pr-1">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    'group rounded-2xl border px-3.5 py-2.5',
                    c.isMine
                      ? 'border-accent/25 bg-accent/10'
                      : 'border-white/10 bg-white/[0.05]',
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        c.isMine ? 'text-accent' : 'text-white/80',
                      )}
                    >
                      {c.isMine ? 'You' : c.authorName}
                    </span>
                    <span className="text-[0.625rem] text-white/35">{ago(c.created_at)}</span>

                    {c.isMine && editingId !== c.id && (
                      <span className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(c.id);
                            setEditDraft(c.body);
                          }}
                          className="rounded-full px-2 py-1 text-[0.625rem] text-white/45 transition hover:text-white"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c.id)}
                          disabled={pending}
                          aria-label="Remove your note"
                          className="rounded-full p-1.5 text-white/40 transition hover:text-danger disabled:opacity-50"
                        >
                          <TrashIcon width={13} height={13} />
                        </button>
                      </span>
                    )}
                  </div>

                  {editingId === c.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        className={field}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-white/60 transition hover:text-white"
                        >
                          <CloseIcon width={12} height={12} />
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(c.id)}
                          disabled={pending || !editDraft.trim()}
                          className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
                        >
                          {pending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-white/85">
                      {c.body}
                    </p>
                  )}
                </li>
              ))}
              <div ref={listEnd} />
            </ul>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter makes a new line.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  post();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Write a little note…"
              className={field}
            />
            <button
              type="button"
              onClick={post}
              disabled={pending || !draft.trim()}
              className="shrink-0 rounded-full bg-gradient-to-br from-accent to-clay px-5 py-3 text-sm font-semibold text-white transition-all duration-300 active:scale-95 disabled:opacity-40"
            >
              {pending ? '…' : 'Send'}
            </button>
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-danger/15 px-3.5 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
