'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ChevronLeftIcon,
  SparkleIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  HeartIcon,
  StarIcon,
  TrashIcon,
} from '@/components/icons';
import PhotoComments from '@/components/PhotoComments';
import PhotoEditor from '@/components/PhotoEditor';
import type { Photo, PhotoComment } from '@/lib/types';
import { moveToCollectionAction } from '@/lib/actions';
import { cn, formatMemoryDate, formatTimestamp, todayISO } from '@/lib/utils';

export type LightboxProps = {
  photos: Photo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onToggleFavorite: (photo: Photo) => void;
  onToggleSpecial: (photo: Photo) => void;
  onDetailsEdited: (photo: Photo, patch: { caption: string; memory_date: string }) => void;
  onDelete: (photo: Photo) => Promise<void>;
  onImageEdited: (photo: Photo, size: { width: number; height: number; size_bytes: number }) => void;
  onCommentsChanged: (photo: Photo, comments: PhotoComment[]) => void;
  /** Called after a successful move. Drops the item from THIS list only —
   *  it must never delete the photo or its files. */
  onMoved?: (photo: Photo) => void;
};

export default function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  onToggleFavorite,
  onToggleSpecial,
  onDetailsEdited,
  onDelete,
  onImageEdited,
  onCommentsChanged,
  onMoved,
}: LightboxProps) {
  const photo = photos[index];

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [direction, setDirection] = useState(0);

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(
    (step: number) => {
      if (photos.length < 2) return;
      setDirection(step);
      onIndexChange((index + step + photos.length) % photos.length);
    },
    [index, photos.length, onIndexChange],
  );

  useEffect(() => {
    setConfirmDelete(false);
    setEditingImage(false);
    setImageLoaded(false);
  }, [photo?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingImage) return; // the editor handles its own keys
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingImage, go, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    for (const step of [1, -1]) {
      const neighbour = photos[(index + step + photos.length) % photos.length];
      if (neighbour && neighbour.id !== photo?.id) {
        const img = new Image();
        img.src = neighbour.url;
      }
    }
  }, [index, photos, photo?.id]);

  if (!photo) return null;

  const remove = async () => {
    setBusy(true);
    try {
      await onDelete(photo);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex flex-col bg-[#0b0807]/95 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onTouchStart={(e) => {
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || editingImage) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
      }}
    >
      {/* The photo's own colour, bloomed behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 blur-[120px] saturate-150 transition-opacity duration-700"
        style={{ backgroundImage: `url(${photo.thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />

      <div
        className="relative flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <span className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium tabular-nums text-white/80 backdrop-blur-xl">
          {index + 1} <span className="text-white/35">/</span> {photos.length}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => onToggleFavorite(photo)}
            active={photo.isFavorite}
            activeClass="border-accent/40 bg-accent/20 text-accent"
          >
            <HeartIcon filled={photo.isFavorite} width={18} height={18} />
          </IconButton>
          <IconButton
            label={photo.is_special ? 'Unmark as special' : 'Mark as special'}
            onClick={() => onToggleSpecial(photo)}
            active={photo.is_special}
            activeClass="border-gold/40 bg-gold/20 text-gold"
          >
            <StarIcon filled={photo.is_special} width={18} height={18} />
          </IconButton>
          <IconButton label="Edit photo & details" onClick={() => setEditingImage(true)} active={editingImage}>
            <EditIcon width={18} height={18} />
          </IconButton>
          {photo.collection === 'moment' && (
            <IconButton label="Move to Recreate Someday" onClick={() => setConfirmMove(true)}>
              <SparkleIcon width={18} height={18} />
            </IconButton>
          )}
          <IconButton label="Delete this photo" onClick={() => setConfirmDelete(true)} hoverClass="hover:bg-danger/25 hover:text-danger">
            <TrashIcon width={18} height={18} />
          </IconButton>
          <IconButton label="Close viewer" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </IconButton>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-4 sm:px-20">
        {photos.length > 1 && (
          <>
            <NavButton side="left" onClick={() => go(-1)} />
            <NavButton side="right" onClick={() => go(1)} />
          </>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photo.id}
          src={photo.url}
          alt={photo.caption ?? `Memory from ${formatMemoryDate(photo.memory_date)}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageLoaded(true)}
          className={cn(
            'max-h-full max-w-full rounded-2xl object-contain shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
            imageLoaded
              ? 'scale-100 opacity-100 blur-0'
              : direction >= 0
                ? 'translate-x-4 scale-[0.97] opacity-0 blur-sm'
                : '-translate-x-4 scale-[0.97] opacity-0 blur-sm',
          )}
        />
        {!imageLoaded && (
          <div className="absolute h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
        )}
      </div>

      <div
        className="relative shrink-0 border-t border-white/10 bg-black/30 px-5 py-5 backdrop-blur-2xl sm:px-8"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="animate-fade space-y-2 text-white">
              {photo.caption && (
                <p className="display text-xl leading-snug sm:text-2xl">{photo.caption}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-white/55">
                <span className="text-white/75">{formatMemoryDate(photo.memory_date)}</span>
                <span className="text-white/25">&middot;</span>
                <span>{photo.uploaderName}</span>
                <span className="text-white/25">&middot;</span>
                <span className="text-white/40">added {formatTimestamp(photo.created_at)}</span>
                {photo.favoritedBy.length > 0 && (
                  <>
                    <span className="text-white/25">&middot;</span>
                    <span className="inline-flex items-center gap-1.5 text-accent">
                      <HeartIcon filled width={11} height={11} />
                      {photo.favoritedBy.join(' & ')}
                    </span>
                  </>
                )}
              </div>
          </div>

          {photo.collection === 'inspiration' && photo.recreated && (
            <div className="mt-3.5 border-t border-white/10 pt-3.5">
              <p className="tracked mb-2.5 text-[0.5625rem] font-semibold text-white/45">
                The inspiration &rarr; our recreation
              </p>
              <div className="flex gap-2.5">
                {[
                  { url: photo.thumbUrl, label: 'Inspiration', tone: 'border-white/20' },
                  { url: photo.recreated.thumbUrl, label: 'Ours', tone: 'border-accent/50' },
                ].map((half) => (
                  <figure key={half.label} className="min-w-0 flex-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={half.url}
                      alt={half.label}
                      className={cn('aspect-4/5 w-full rounded-xl border object-cover', half.tone)}
                    />
                    <figcaption className="mt-1.5 text-center text-[0.625rem] font-medium text-white/60">
                      {half.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="mt-2 text-center text-[0.6875rem] text-white/40">
                Recreated on {formatMemoryDate(photo.recreated.memory_date)}
              </p>
            </div>
          )}

          <PhotoComments
            photoId={photo.id}
            comments={photo.comments ?? []}
            onChange={(next) => onCommentsChanged(photo, next)}
          />
        </div>
      </div>

      {editingImage && (
        <PhotoEditor
          photo={photo}
          onCancel={() => setEditingImage(false)}
          onSaved={({ caption, memory_date, image }) => {
            setEditingImage(false);
            onDetailsEdited(photo, { caption, memory_date });
            if (image) onImageEdited(photo, image);
          }}
        />
      )}

      {confirmMove && (
        <div className="animate-fade absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
          <div className="card animate-zoom w-full max-w-sm p-7 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-soft text-gold">
              <SparkleIcon width={20} height={20} />
            </span>
            <h3 className="display text-xl">Move to Recreate Someday?</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              It leaves Our Moments and becomes something to recreate later. The photo itself is
              not copied and nothing is left behind in storage.
            </p>
            {moveError && (
              <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
                {moveError}
              </p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => { setMoveError(null); setConfirmMove(false); }}
                className="flex-1 rounded-full border border-line px-4 py-3 text-sm font-medium transition hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={moveBusy}
                onClick={async () => {
                  setMoveBusy(true);
                  const r = await moveToCollectionAction(photo.id, 'inspiration');
                  setMoveBusy(false);
                  setConfirmMove(false);
                  if (r.ok) {
                    // Deliberately NOT onDelete: the photo must survive the
                    // move. This only takes it out of the list on screen.
                    onMoved?.(photo);
                  } else {
                    setMoveError(r.error);
                  }
                }}
                className="flex-1 rounded-full bg-gradient-to-br from-accent to-clay px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
              >
                {moveBusy ? 'Moving…' : 'Move it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="animate-fade absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
          <div className="card animate-zoom w-full max-w-sm p-7 text-center shadow-float">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <TrashIcon width={20} height={20} />
            </span>
            <h3 className="display text-xl">Delete this memory?</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              It will be gone for both of you. This cannot be undone.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-full border border-line px-4 py-3 text-sm font-medium transition hover:bg-surface-2"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="flex-1 rounded-full bg-danger px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active = false,
  activeClass = 'border-white/25 bg-white/20 text-white',
  hoverClass = 'hover:bg-white/15 hover:text-white',
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
  hoverClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-xl transition-all duration-300 active:scale-90',
        active ? activeClass : `border-white/10 bg-white/5 text-white/80 ${hoverClass}`,
      )}
    >
      {children}
    </button>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous photo' : 'Next photo'}
      className={cn(
        'absolute top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white backdrop-blur-xl transition-all duration-300 hover:bg-white/15 active:scale-90 sm:flex',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {side === 'left' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}
