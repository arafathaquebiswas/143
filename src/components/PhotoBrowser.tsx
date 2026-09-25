'use client';

import { useMemo, useState, useTransition } from 'react';

import Lightbox from '@/components/Lightbox';
import PhotoCard from '@/components/PhotoCard';
import { CameraIcon, HeartIcon } from '@/components/icons';
import {
  type ActionResult,
  deletePhotoAction,
  loadMorePhotosAction,
  toggleFavoriteAction,
  updatePhotoAction,
} from '@/lib/actions';
import { PAGE_SIZE } from '@/lib/constants';
import type { Photo, PhotoFilter } from '@/lib/types';
import { formatDayHeading, formatMonthHeading } from '@/lib/utils';

type Layout = 'grid' | 'timeline' | 'rail';

export default function PhotoBrowser({
  initialPhotos,
  filter,
  layout = 'grid',
  loadMore = false,
  emptyTitle = 'Nothing here yet',
  emptyHint = 'Photos you upload will appear here.',
}: {
  initialPhotos: Photo[];
  filter?: PhotoFilter;
  layout?: Layout;
  loadMore?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const [items, setItems] = useState<Photo[]>(initialPhotos);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [exhausted, setExhausted] = useState(initialPhotos.length < PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, startLoading] = useTransition();
  const [, startMutation] = useTransition();

  /** Applies a local change straight away, then persists it. On failure only
   *  the fields we touched are rolled back, so a slower request cannot undo a
   *  newer change to a different photo. */
  const mutate = (
    id: string,
    patch: Partial<Photo>,
    persist: () => Promise<ActionResult>,
  ) => {
    const before = items.find((p) => p.id === id);
    setItems((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)));

    startMutation(async () => {
      const result = await persist();
      if (result.ok || !before) return;

      const rollback = Object.fromEntries(
        Object.keys(patch).map((key) => [key, before[key as keyof Photo]]),
      ) as Partial<Photo>;

      setItems((current) => current.map((p) => (p.id === id ? { ...p, ...rollback } : p)));
      setError(result.error);
    });
  };

  const toggleFavorite = (photo: Photo) => {
    const next = !photo.isFavorite;
    mutate(photo.id, { isFavorite: next }, () => toggleFavoriteAction(photo.id, next));
  };

  const toggleSpecial = (photo: Photo) => {
    const next = !photo.is_special;
    mutate(photo.id, { is_special: next }, () =>
      updatePhotoAction(photo.id, { is_special: next }),
    );
  };

  const savePhoto = async (photo: Photo, patch: { caption: string; memory_date: string }) => {
    const result = await updatePhotoAction(photo.id, patch);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setItems((current) =>
      current.map((p) =>
        p.id === photo.id ? { ...p, caption: patch.caption.trim() || null, memory_date: patch.memory_date } : p,
      ),
    );
  };

  const removePhoto = async (photo: Photo) => {
    const result = await deletePhotoAction(photo.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const remaining = items.filter((p) => p.id !== photo.id);
    setItems(remaining);
    setOpenIndex((idx) =>
      idx === null || remaining.length === 0 ? null : Math.min(idx, remaining.length - 1),
    );
  };

  const fetchMore = () => {
    setError(null);
    startLoading(async () => {
      try {
        const more = await loadMorePhotosAction({
          ...filter,
          limit: PAGE_SIZE,
          offset: items.length,
        });
        setItems((current) => {
          const seen = new Set(current.map((p) => p.id));
          return [...current, ...more.filter((p) => !seen.has(p.id))];
        });
        if (more.length < PAGE_SIZE) setExhausted(true);
      } catch {
        setError('Could not load more photos. Try again.');
      }
    });
  };

  const months = useMemo(() => (layout === 'timeline' ? groupByMonth(items) : []), [items, layout]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 py-16 text-center">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CameraIcon width={24} height={24} />
        </span>
        <h3 className="font-display text-xl">{emptyTitle}</h3>
        <p className="mt-1.5 max-w-xs text-sm text-muted">{emptyHint}</p>
      </div>
    );
  }

  const openAt = (photo: Photo) => setOpenIndex(items.findIndex((p) => p.id === photo.id));

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {layout === 'rail' && (
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {items.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              showMeta={false}
              onOpen={() => openAt(photo)}
              onToggleFavorite={() => toggleFavorite(photo)}
              className="animate-rise w-40 shrink-0 snap-start sm:w-48"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            />
          ))}
        </div>
      )}

      {layout === 'grid' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {items.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              onOpen={() => openAt(photo)}
              onToggleFavorite={() => toggleFavorite(photo)}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
            />
          ))}
        </div>
      )}

      {layout === 'timeline' && (
        <div className="space-y-12">
          {months.map((month) => (
            <section key={month.key}>
              <div className="mb-5 flex items-center gap-3">
                <h2 className="font-display text-2xl sm:text-3xl">{month.label}</h2>
                <span className="h-px flex-1 bg-line" />
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                  {month.count} {month.count === 1 ? 'photo' : 'photos'}
                </span>
              </div>

              <div className="space-y-8">
                {month.days.map((day) => (
                  <div key={day.key}>
                    <p className="mb-3 flex items-center gap-2 text-sm font-medium text-accent">
                      <HeartIcon filled width={14} height={14} />
                      <span className="text-ink">{day.title}</span>
                      <span className="text-muted">· {day.label}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                      {day.photos.map((photo) => (
                        <PhotoCard
                          key={photo.id}
                          photo={photo}
                          showMeta={false}
                          onOpen={() => openAt(photo)}
                          onToggleFavorite={() => toggleFavorite(photo)}
                          className="animate-rise"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {loadMore && !exhausted && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={fetchMore}
            disabled={loadingMore}
            className="rounded-full border border-line bg-surface px-6 py-3 text-sm font-medium shadow-soft transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more memories'}
          </button>
        </div>
      )}

      {openIndex !== null && items[openIndex] && (
        <Lightbox
          photos={items}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onToggleFavorite={toggleFavorite}
          onToggleSpecial={toggleSpecial}
          onSave={savePhoto}
          onDelete={removePhoto}
        />
      )}
    </div>
  );
}

type DayGroup = { key: string; label: string; title: string; photos: Photo[] };
type MonthGroup = { key: string; label: string; count: number; days: DayGroup[] };

/** Buckets an already-sorted list into month sections and day sub-sections. */
function groupByMonth(photos: Photo[]): MonthGroup[] {
  const months = new Map<string, Map<string, Photo[]>>();

  for (const photo of photos) {
    const monthKey = photo.memory_date.slice(0, 7);
    const dayKey = photo.memory_date;
    if (!months.has(monthKey)) months.set(monthKey, new Map());
    const days = months.get(monthKey)!;
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey)!.push(photo);
  }

  return [...months.entries()].map(([monthKey, days]) => {
    const dayGroups: DayGroup[] = [...days.entries()].map(([dayKey, dayPhotos]) => ({
      key: dayKey,
      label: formatDayHeading(dayKey),
      // The first caption of the day doubles as that day's little headline.
      title: dayPhotos.find((p) => p.caption)?.caption ?? 'A day together',
      photos: dayPhotos,
    }));

    return {
      key: monthKey,
      label: formatMonthHeading(`${monthKey}-01`),
      count: dayGroups.reduce((sum, d) => sum + d.photos.length, 0),
      days: dayGroups,
    };
  });
}
