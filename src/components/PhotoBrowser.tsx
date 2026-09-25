'use client';

import { useRouter } from 'next/navigation';
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
import type { Photo, PhotoComment, PhotoFilter } from '@/lib/types';
import { formatDayHeading, formatMonthHeading } from '@/lib/utils';

type Layout = 'grid' | 'masonry' | 'timeline' | 'rail';

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
  const router = useRouter();
  const [loadingMore, startLoading] = useTransition();
  const [, startMutation] = useTransition();

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
    mutate(photo.id, { is_special: next }, () => updatePhotoAction(photo.id, { is_special: next }));
  };

  const applyEditedDetails = (photo: Photo, patch: { caption: string; memory_date: string }) => {
    setItems((current) =>
      current.map((p) =>
        p.id === photo.id
          ? { ...p, caption: patch.caption.trim() || null, memory_date: patch.memory_date }
          : p,
      ),
    );
  };

  const removePhoto = async (photo: Photo) => {
    const result = await deletePhotoAction(photo.id);
    if (!result.ok) return setError(result.error);
    const remaining = items.filter((p) => p.id !== photo.id);
    setItems(remaining);
    setOpenIndex((idx) =>
      idx === null || remaining.length === 0 ? null : Math.min(idx, remaining.length - 1),
    );
  };

  /**
   * After an edit the picture lives at the same storage path, so its signed
   * URL is unchanged and the browser would happily keep showing the cached
   * old version. A throwaway query parameter forces a re-fetch; router.refresh
   * then pulls freshly signed URLs from the server.
   */
  const handleImageEdited = (
    photo: Photo,
    size: { width: number; height: number; size_bytes: number },
  ) => {
    const bust = (url: string) =>
      url ? `${url}${url.includes('?') ? '&' : '?'}edited=${Date.now()}` : url;

    setItems((current) =>
      current.map((p) =>
        p.id === photo.id
          ? {
              ...p,
              url: bust(p.url),
              thumbUrl: bust(p.thumbUrl),
              width: size.width,
              height: size.height,
              size_bytes: size.size_bytes,
            }
          : p,
      ),
    );
    router.refresh();
  };

  /** Comments changed inside the viewer — keep them after it closes. */
  const applyComments = (photo: Photo, comments: PhotoComment[]) => {
    setItems((current) => current.map((p) => (p.id === photo.id ? { ...p, comments } : p)));
  };

  const fetchMore = () => {
    setError(null);
    startLoading(async () => {
      try {
        const more = await loadMorePhotosAction({ ...filter, limit: PAGE_SIZE, offset: items.length });
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

  if (items.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  const openAt = (photo: Photo) => setOpenIndex(items.findIndex((p) => p.id === photo.id));

  const cardProps = (photo: Photo, i: number) => ({
    photo,
    onOpen: () => openAt(photo),
    onToggleFavorite: () => toggleFavorite(photo),
    className: 'animate-reveal',
    style: { animationDelay: `${Math.min(i, 14) * 45}ms` },
  });

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded-2xl border border-danger/25 bg-danger/10 px-5 py-3.5 text-sm text-danger">
          {error}
        </p>
      )}

      {layout === 'rail' && (
        <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
          {items.map((photo, i) => (
            <PhotoCard
              key={photo.id}
              {...cardProps(photo, i)}
              ratio="portrait"
              className="animate-reveal w-[9.5rem] shrink-0 snap-start sm:w-[12rem]"
            />
          ))}
        </div>
      )}

      {layout === 'grid' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {items.map((photo, i) => (
            <PhotoCard key={photo.id} {...cardProps(photo, i)} ratio="portrait" />
          ))}
        </div>
      )}

      {layout === 'masonry' && (
        <div className="masonry columns-2 sm:columns-3 lg:columns-4">
          {items.map((photo, i) => (
            <PhotoCard key={photo.id} {...cardProps(photo, i)} ratio="natural" />
          ))}
        </div>
      )}

      {layout === 'timeline' && (
        <div className="space-y-16">
          {months.map((month, mi) => (
            <section key={month.key} className="animate-reveal" style={{ animationDelay: `${mi * 70}ms` }}>
              <div className="mb-7 flex items-baseline gap-4">
                <h2 className="display text-[1.75rem] leading-none sm:text-[2.25rem]">
                  {month.label}
                </h2>
                <span className="hairline flex-1" />
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
                  {month.count}
                </span>
              </div>

              <div className="space-y-10">
                {month.days.map((day) => (
                  <div key={day.key}>
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="text-accent">
                        <HeartIcon filled width={13} height={13} />
                      </span>
                      <p className="text-[0.9375rem] font-medium leading-none text-ink">
                        {day.title}
                      </p>
                      <span className="text-xs text-muted">{day.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                      {day.photos.map((photo, i) => (
                        <PhotoCard key={photo.id} {...cardProps(photo, i)} ratio="portrait" />
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
        <div className="flex justify-center pt-4">
          <button
            type="button"
            onClick={fetchMore}
            disabled={loadingMore}
            className="sheen rounded-full border border-line/70 bg-surface/70 px-8 py-3.5 text-sm font-medium backdrop-blur-xl transition-all duration-300 hover:border-accent/40 hover:text-accent disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more memories'}
          </button>
        </div>
      )}

      {openIndex !== null && items[openIndex] && (
        <Lightbox
          onCommentsChanged={applyComments}
          onMoved={(photo) => {
            // The photo still exists, it simply belongs to the other
            // collection now, so it leaves this view without being deleted.
            const left = items.filter((p) => p.id !== photo.id);
            setItems(left);
            setOpenIndex((i) => (i === null || left.length === 0 ? null : Math.min(i, left.length - 1)));
          }}
          photos={items}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onToggleFavorite={toggleFavorite}
          onToggleSpecial={toggleSpecial}
          onDetailsEdited={applyEditedDetails}
          onDelete={removePhoto}
          onImageEdited={handleImageEdited}
        />
      )}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="animate-reveal relative overflow-hidden rounded-[var(--radius-xl2)] border border-dashed border-line-strong/70 bg-surface/40 px-8 py-20 text-center">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent-soft/40 to-transparent" />
      <div className="relative">
        <span className="animate-breathe mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-accent/15 to-clay/10 text-accent ring-1 ring-accent/15">
          <CameraIcon width={26} height={26} />
        </span>
        <h3 className="display text-2xl">{title}</h3>
        <p className="mx-auto mt-2.5 max-w-xs text-sm leading-relaxed text-muted">{hint}</p>
      </div>
    </div>
  );
}

type DayGroup = { key: string; label: string; title: string; photos: Photo[] };
type MonthGroup = { key: string; label: string; count: number; days: DayGroup[] };

function groupByMonth(photos: Photo[]): MonthGroup[] {
  const months = new Map<string, Map<string, Photo[]>>();
  for (const photo of photos) {
    const monthKey = photo.memory_date.slice(0, 7);
    if (!months.has(monthKey)) months.set(monthKey, new Map());
    const days = months.get(monthKey)!;
    if (!days.has(photo.memory_date)) days.set(photo.memory_date, []);
    days.get(photo.memory_date)!.push(photo);
  }

  return [...months.entries()].map(([monthKey, days]) => {
    const dayGroups: DayGroup[] = [...days.entries()].map(([dayKey, dayPhotos]) => ({
      key: dayKey,
      label: formatDayHeading(dayKey),
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
