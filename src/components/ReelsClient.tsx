'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import PhotoComments from '@/components/PhotoComments';
import ReelUploader from '@/components/ReelUploader';
import { CameraIcon, HeartIcon, TrashIcon } from '@/components/icons';
import {
  type ActionResult,
  deletePhotoAction,
  loadMoreReelsAction,
  toggleFavoriteAction,
  updatePhotoAction,
} from '@/lib/actions';
import type { Photo, PhotoComment } from '@/lib/types';
import { cn, formatMemoryDate } from '@/lib/utils';
import { VIDEO_RETENTION_DAYS, daysUntilExpiry, formatDuration } from '@/lib/video';

const PAGE = 24;

export default function ReelsClient({
  initialReels,
  userId,
}: {
  initialReels: Photo[];
  userId: string;
}) {
  const [items, setItems] = useState<Photo[]>(initialReels);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(initialReels.length < PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ caption: '', memory_date: '' });
  const [loadingMore, startLoading] = useTransition();
  const [, startMutation] = useTransition();

  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const cardRefs = useRef(new Map<string, HTMLElement>());

  // A notification deep-links here with ?clip=<id>; bring that one into view.
  const params = useSearchParams();
  const wantedId = params.get('clip');
  useEffect(() => {
    if (!wantedId) return;
    const card = cardRefs.current.get(wantedId);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedId, items.length]);

  /** Only one reel plays at a time; everything else is paused and released. */
  const pauseOthers = (keepId: string) => {
    for (const [id, el] of videoRefs.current) {
      if (id !== keepId && !el.paused) el.pause();
    }
  };

  // A reel scrolled out of view stops playing, so nothing keeps streaming
  // in the background and eating data.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLVideoElement;
          if (!entry.isIntersecting && !el.paused) el.pause();
        }
      },
      { threshold: 0.35 },
    );
    for (const el of videoRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  const patch = (id: string, next: Partial<Photo>) =>
    setItems((cur) => cur.map((p) => (p.id === id ? { ...p, ...next } : p)));

  const run = (id: string, optimistic: Partial<Photo>, fn: () => Promise<ActionResult>) => {
    const before = items.find((p) => p.id === id);
    patch(id, optimistic);
    startMutation(async () => {
      const r = await fn();
      if (!r.ok && before) {
        patch(id, Object.fromEntries(
          Object.keys(optimistic).map((k) => [k, before[k as keyof Photo]]),
        ) as Partial<Photo>);
        setError(r.error);
      }
    });
  };

  const remove = async (reel: Photo) => {
    const r = await deletePhotoAction(reel.id);
    if (!r.ok) return setError(r.error);
    videoRefs.current.delete(reel.id);
    setItems((cur) => cur.filter((p) => p.id !== reel.id));
  };

  const saveEdit = (reel: Photo) => {
    const next = { caption: draft.caption, memory_date: draft.memory_date };
    setEditing(null);
    startMutation(async () => {
      const r = await updatePhotoAction(reel.id, next);
      if (!r.ok) return setError(r.error);
      patch(reel.id, { caption: next.caption.trim() || null, memory_date: next.memory_date });
    });
  };

  /** Pull the feed again so a just-posted reel appears without a reload. */
  const refetch = async () => {
    try {
      const fresh = await loadMoreReelsAction(0);
      setItems(fresh);
      setExhausted(fresh.length < PAGE);
    } catch {
      setError('Saved, but the feed could not refresh. Reload to see it.');
    }
  };

  const fetchMore = () =>
    startLoading(async () => {
      try {
        const more = await loadMoreReelsAction(items.length);
        setItems((cur) => {
          const seen = new Set(cur.map((p) => p.id));
          return [...cur, ...more.filter((p) => !seen.has(p.id))];
        });
        if (more.length < PAGE) setExhausted(true);
      } catch {
        setError('Could not load more clips.');
      }
    });

  const field =
    'w-full rounded-2xl border border-line bg-bg/60 px-4 py-3 text-base focus:border-accent/50 focus:outline-none sm:text-sm';

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-2xl border border-danger/25 bg-danger/10 px-5 py-3.5 text-sm text-danger">
          {error}
        </p>
      )}

      {uploading ? (
        <ReelUploader userId={userId} onDone={() => setUploading(false)} onPosted={refetch} />
      ) : (
        <button
          type="button"
          onClick={() => setUploading(true)}
          className="sheen min-h-14 w-full rounded-2xl bg-gradient-to-br from-accent to-clay px-5 py-4 text-sm font-semibold text-white shadow-glow transition-all duration-300 active:scale-[0.99]"
        >
          <span className="inline-flex items-center justify-center gap-2.5">
            <CameraIcon width={18} height={18} />
            Add a Little Clip
          </span>
        </button>
      )}

      {items.length === 0 && !uploading ? (
        <div className="animate-reveal relative overflow-hidden rounded-[var(--radius-xl2)] border border-dashed border-line-strong/70 bg-surface/40 px-8 py-20 text-center">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent-soft/40 to-transparent" />
          <div className="relative">
            <span className="animate-breathe mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-accent/15 to-clay/10 text-accent ring-1 ring-accent/15">
              <CameraIcon width={26} height={26} />
            </span>
            <h3 className="display text-2xl">No clips yet</h3>
            <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-muted">
              Short videos of the two of you. Up to 45 seconds each.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {items.map((reel, i) => {
            const left = daysUntilExpiry(reel.expires_at);
            return (
              <article
                key={reel.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(reel.id, el);
                  else cardRefs.current.delete(reel.id);
                }}
                className={cn(
                  'card animate-reveal overflow-hidden p-0',
                  wantedId === reel.id && 'ring-2 ring-accent/40',
                )}
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              >
                <div className="relative bg-black">
                  {/*
                    poster + preload="none": opening this page downloads only
                    the poster image. The video itself is fetched the moment
                    it is played, and not before.
                  */}
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(reel.id, el);
                      else videoRefs.current.delete(reel.id);
                    }}
                    src={reel.url}
                    poster={reel.thumbUrl}
                    controls
                    playsInline
                    preload="none"
                    onPlay={() => pauseOthers(reel.id)}
                    className="aspect-4/5 w-full bg-black object-contain"
                  />
                  {reel.duration_seconds ? (
                    <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[0.625rem] font-semibold text-white backdrop-blur-md">
                      {formatDuration(reel.duration_seconds)}
                    </span>
                  ) : null}
                </div>

                <div className="space-y-3 p-4">
                  {editing === reel.id ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={draft.caption}
                        maxLength={500}
                        onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))}
                        placeholder="Caption"
                        className={field}
                      />
                      <input
                        type="date"
                        value={draft.memory_date}
                        onChange={(e) => setDraft((d) => ({ ...d, memory_date: e.target.value }))}
                        className={field}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="rounded-full px-4 py-2 text-sm text-muted transition hover:text-ink"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(reel)}
                          className="rounded-full bg-gradient-to-br from-accent to-clay px-5 py-2 text-sm font-semibold text-white transition"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {reel.caption && (
                            <p className="text-sm font-medium leading-snug text-ink">{reel.caption}</p>
                          )}
                          <p className={cn('text-xs text-muted', reel.caption && 'mt-1')}>
                            {formatMemoryDate(reel.memory_date)} · {reel.uploaderName}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => run(reel.id, { isFavorite: !reel.isFavorite }, () => toggleFavoriteAction(reel.id, !reel.isFavorite))}
                          aria-pressed={reel.isFavorite}
                          aria-label={reel.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          className={cn(
                            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition',
                            reel.isFavorite
                              ? 'border-accent/40 bg-accent-soft text-accent'
                              : 'border-line text-muted hover:text-accent',
                          )}
                        >
                          <HeartIcon filled={reel.isFavorite} width={16} height={16} />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {left !== null && (
                          <span className="rounded-full border border-line bg-surface-2/60 px-3 py-1.5 text-[0.6875rem] text-muted">
                            {left === 0 ? 'Expires today' : `Expires in ${left} ${left === 1 ? 'day' : 'days'}`}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ caption: reel.caption ?? '', memory_date: reel.memory_date });
                            setEditing(reel.id);
                          }}
                          className="ml-auto min-h-9 rounded-full px-3 py-2.5 text-xs font-medium text-muted transition hover:text-accent"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(reel)}
                          aria-label="Delete this clip"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition hover:border-danger/40 hover:text-danger"
                        >
                          <TrashIcon width={14} height={14} />
                        </button>
                      </div>
                    </>
                  )}

                  <PhotoComments
                    photoId={reel.id}
                    comments={reel.comments ?? []}
                    onChange={(next: PhotoComment[]) => patch(reel.id, { comments: next })}
                    tone="light"
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!exhausted && items.length > 0 && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={fetchMore}
            disabled={loadingMore}
            className="rounded-full border border-line/70 bg-surface/70 px-8 py-3.5 text-sm font-medium backdrop-blur-xl transition hover:border-accent/40 hover:text-accent disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more clips'}
          </button>
        </div>
      )}

      <p className="pb-2 text-center text-xs text-muted/70">
        Video memories are kept for {VIDEO_RETENTION_DAYS} days.
      </p>
    </div>
  );
}
