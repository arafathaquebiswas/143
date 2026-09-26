'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import Lightbox from '@/components/Lightbox';
import PhotoComments from '@/components/PhotoComments';
import { CameraIcon, CheckIcon, HeartIcon, StarIcon, TrashIcon } from '@/components/icons';
import {
  type ActionResult,
  deletePhotoAction,
  loadMorePhotosAction,
  moveToCollectionAction,
  toggleFavoriteAction,
  unmarkRecreatedAction,
  updatePhotoAction,
} from '@/lib/actions';
import { PAGE_SIZE } from '@/lib/constants';
import type { Photo, PhotoComment, PhotoFilter } from '@/lib/types';
import { cn, formatMemoryDate, formatTimestamp, todayISO } from '@/lib/utils';

/**
 * Recreate Someday. Deliberately a separate surface from PhotoBrowser: these
 * cards carry a status, a recreate action and a before/after pair, and mixing
 * that into the gallery would complicate a component that already works.
 */
export default function InspirationBrowser({
  initialPhotos,
  filter,
  emptyTitle,
  emptyHint,
}: {
  initialPhotos: Photo[];
  filter?: PhotoFilter;
  emptyTitle: string;
  emptyHint: string;
}) {
  const [items, setItems] = useState<Photo[]>(initialPhotos);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [exhausted, setExhausted] = useState(initialPhotos.length < PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<Photo | null>(null);
  const [moveDate, setMoveDate] = useState(todayISO());
  const [loadingMore, startLoading] = useTransition();
  const [, startMutation] = useTransition();

  const patch = (id: string, next: Partial<Photo>) =>
    setItems((cur) => cur.map((p) => (p.id === id ? { ...p, ...next } : p)));

  const run = (id: string, optimistic: Partial<Photo>, fn: () => Promise<ActionResult>) => {
    const before = items.find((p) => p.id === id);
    patch(id, optimistic);
    startMutation(async () => {
      const r = await fn();
      if (!r.ok && before) {
        patch(id, Object.fromEntries(Object.keys(optimistic).map((k) => [k, before[k as keyof Photo]])) as Partial<Photo>);
        setError(r.error);
      }
    });
  };

  const toggleFavorite = (p: Photo) =>
    run(p.id, { isFavorite: !p.isFavorite }, () => toggleFavoriteAction(p.id, !p.isFavorite));

  // A Recreate Someday notification deep-links here with ?item=<id>; open that
  // exact one, the same way the gallery handles ?photo=<id>.
  const params = useSearchParams();
  const wantedId = params.get('item');
  useEffect(() => {
    if (!wantedId) return;
    const idx = items.findIndex((p) => p.id === wantedId);
    if (idx >= 0) setOpenIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedId, items.length]);

  const removeItem = async (p: Photo) => {
    const r = await deletePhotoAction(p.id);
    if (!r.ok) return setError(r.error);
    const left = items.filter((x) => x.id !== p.id);
    setItems(left);
    setOpenIndex((i) => (i === null || left.length === 0 ? null : Math.min(i, left.length - 1)));
  };

  const confirmMove = () => {
    if (!moving) return;
    const target = moving;
    setMoving(null);
    startMutation(async () => {
      const r = await moveToCollectionAction(target.id, 'moment', moveDate);
      if (!r.ok) return setError(r.error);
      setItems((cur) => cur.filter((p) => p.id !== target.id));
    });
  };

  const undoRecreated = (p: Photo) =>
    startMutation(async () => {
      const r = await unmarkRecreatedAction(p.id);
      if (!r.ok) return setError(r.error);
      setItems((cur) => cur.filter((x) => x.id !== p.id));
    });

  const fetchMore = () => {
    startLoading(async () => {
      try {
        const more = await loadMorePhotosAction({ ...filter, limit: PAGE_SIZE, offset: items.length });
        setItems((cur) => {
          const seen = new Set(cur.map((p) => p.id));
          return [...cur, ...more.filter((p) => !seen.has(p.id))];
        });
        if (more.length < PAGE_SIZE) setExhausted(true);
      } catch {
        setError('Could not load more. Try again.');
      }
    });
  };

  if (items.length === 0) {
    return (
      <div className="animate-reveal relative overflow-hidden rounded-[var(--radius-xl2)] border border-dashed border-line-strong/70 bg-surface/40 px-8 py-20 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent-soft/40 to-transparent" />
        <div className="relative">
          <span className="animate-breathe mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-accent/15 to-clay/10 text-accent ring-1 ring-accent/15">
            <StarIcon width={26} height={26} />
          </span>
          <h3 className="display text-2xl">{emptyTitle}</h3>
          <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-muted">{emptyHint}</p>
          <Link
            href="/upload"
            className="sheen mt-7 inline-flex items-center gap-2.5 rounded-full bg-gradient-to-br from-accent to-clay px-6 py-3 text-sm font-semibold text-white shadow-glow transition"
          >
            <CameraIcon width={16} height={16} />
            Add an inspiration
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-2xl border border-danger/25 bg-danger/10 px-5 py-3.5 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((photo, i) => {
          const recreated = !!photo.recreated_at;
          return (
            <article
              key={photo.id}
              className="card animate-reveal overflow-hidden p-0"
              style={{ animationDelay: `${Math.min(i, 10) * 50}ms` }}
            >
              {/* Inspiration, and its recreation when there is one */}
              <div className={cn('grid gap-px bg-line', photo.recreated ? 'grid-cols-2' : 'grid-cols-1')}>
                <figure className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(i)}
                    className="block w-full cursor-zoom-in"
                    aria-label={photo.caption ? `Open: ${photo.caption}` : 'Open inspiration'}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbUrl}
                      alt={photo.caption ?? 'An inspiration'}
                      loading="lazy"
                      className="aspect-4/5 w-full bg-surface-2 object-cover"
                    />
                  </button>
                  {photo.recreated && (
                    <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full border border-white/25 bg-black/45 px-2.5 py-1 text-[0.5625rem] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-md">
                      Inspiration
                    </span>
                  )}
                </figure>

                {photo.recreated && (
                  <figure className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.recreated.thumbUrl}
                      alt={photo.recreated.caption ?? 'Our recreation'}
                      loading="lazy"
                      className="aspect-4/5 w-full bg-surface-2 object-cover"
                    />
                    <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full border border-accent/40 bg-accent/85 px-2.5 py-1 text-[0.5625rem] font-semibold uppercase tracking-wide text-white backdrop-blur-md">
                      Ours
                    </span>
                  </figure>
                )}
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug text-ink">
                      {photo.caption || 'Let us recreate this'}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Added by {photo.uploaderName} · {formatTimestamp(photo.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(photo)}
                    aria-pressed={photo.isFavorite}
                    aria-label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    className={cn(
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition',
                      photo.isFavorite
                        ? 'border-accent/40 bg-accent-soft text-accent'
                        : 'border-line text-muted hover:text-accent',
                    )}
                  >
                    <HeartIcon filled={photo.isFavorite} width={16} height={16} />
                  </button>
                </div>

                {recreated ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex flex-1 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3.5 py-2 text-xs font-semibold text-accent">
                      <CheckIcon width={13} height={13} />
                      Recreated
                      {photo.recreated && ` · ${formatMemoryDate(photo.recreated.memory_date)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => undoRecreated(photo)}
                      className="rounded-full px-3 py-2 text-xs text-muted transition hover:text-ink"
                    >
                      Undo
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/upload?recreate=${photo.id}`}
                      className="sheen inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-accent to-clay px-4 py-2.5 text-[0.8125rem] font-semibold text-white shadow-glow transition"
                    >
                      <HeartIcon filled width={14} height={14} />
                      We recreated this
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setMoveDate(todayISO());
                        setMoving(photo);
                      }}
                      className="inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 py-2.5 text-[0.8125rem] font-medium text-muted transition hover:border-accent/40 hover:text-accent"
                    >
                      Move
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(photo)}
                      aria-label="Delete this inspiration"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-muted transition hover:border-danger/40 hover:text-danger"
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                  </div>
                )}

                <PhotoComments
                  photoId={photo.id}
                  comments={photo.comments ?? []}
                  onChange={(next) => patch(photo.id, { comments: next })}
                  tone="light"
                />
              </div>
            </article>
          );
        })}
      </div>

      {!exhausted && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={fetchMore}
            disabled={loadingMore}
            className="rounded-full border border-line/70 bg-surface/70 px-8 py-3.5 text-sm font-medium backdrop-blur-xl transition hover:border-accent/40 hover:text-accent disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {/* Move confirmation */}
      {moving && (
        <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="card animate-zoom w-full max-w-sm p-7">
            <h3 className="display text-xl">Move to Our Moments?</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This becomes a real memory. The picture itself is not copied and nothing is left
              behind in storage.
            </p>
            <label className="mt-5 block">
              <span className="tracked mb-2 block text-[0.625rem] font-semibold text-muted">
                When did it happen?
              </span>
              <input
                type="date"
                value={moveDate}
                onChange={(e) => setMoveDate(e.target.value)}
                className="w-full rounded-2xl border border-line bg-bg/60 px-4 py-3 text-base focus:border-accent/50 focus:outline-none sm:text-sm"
              />
            </label>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setMoving(null)}
                className="flex-1 rounded-full border border-line px-4 py-3 text-sm font-medium transition hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMove}
                className="flex-1 rounded-full bg-gradient-to-br from-accent to-clay px-4 py-3 text-sm font-semibold text-white transition"
              >
                Move it
              </button>
            </div>
          </div>
        </div>
      )}

      {openIndex !== null && items[openIndex] && (
        <Lightbox
          photos={items}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onToggleFavorite={toggleFavorite}
          onToggleSpecial={(p) => run(p.id, { is_special: !p.is_special }, () => updatePhotoAction(p.id, { is_special: !p.is_special }))}
          onDetailsEdited={(p, d) => patch(p.id, { caption: d.caption.trim() || null, memory_date: d.memory_date })}
          onDelete={removeItem}
          onImageEdited={(p, size) => patch(p.id, size)}
          onCommentsChanged={(p, next: PhotoComment[]) => patch(p.id, { comments: next })}
        />
      )}
    </div>
  );
}
