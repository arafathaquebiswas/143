'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  HeartIcon,
  StarIcon,
  TrashIcon,
} from '@/components/icons';
import type { Photo } from '@/lib/types';
import { cn, formatMemoryDate, formatTimestamp } from '@/lib/utils';

export type LightboxProps = {
  photos: Photo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onToggleFavorite: (photo: Photo) => void;
  onToggleSpecial: (photo: Photo) => void;
  onSave: (photo: Photo, patch: { caption: string; memory_date: string }) => Promise<void>;
  onDelete: (photo: Photo) => Promise<void>;
};

export default function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  onToggleFavorite,
  onToggleSpecial,
  onSave,
  onDelete,
}: LightboxProps) {
  const photo = photos[index];

  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState('');
  const [memoryDate, setMemoryDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const go = useCallback(
    (step: number) => {
      if (photos.length < 2) return;
      const next = (index + step + photos.length) % photos.length;
      onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  // Reset transient UI whenever a different photo comes into view.
  useEffect(() => {
    setEditing(false);
    setConfirmDelete(false);
    setImageLoaded(false);
  }, [photo?.id]);

  // Keyboard control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) {
        if (e.key === 'Escape') setEditing(false);
        return;
      }
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, go, onClose]);

  // Keep the page behind from scrolling while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Warm up the neighbouring images so paging feels instant.
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

  const startEditing = () => {
    setCaption(photo.caption ?? '');
    setMemoryDate(photo.memory_date);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave(photo, { caption, memory_date: memoryDate });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

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
      className="animate-fade fixed inset-0 z-50 flex flex-col bg-black/92 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onTouchStart={(e) => {
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || editing) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
      }}
    >
      {/* Top bar */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 pt-3 text-white/90 sm:px-5 sm:pt-4"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs tabular-nums">
          {index + 1} / {photos.length}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => onToggleFavorite(photo)}
            active={photo.isFavorite}
          >
            <HeartIcon filled={photo.isFavorite} />
          </IconButton>
          <IconButton
            label={photo.is_special ? 'Unmark as special' : 'Mark as special'}
            onClick={() => onToggleSpecial(photo)}
            active={photo.is_special}
            activeClass="bg-gold/25 text-gold"
          >
            <StarIcon filled={photo.is_special} />
          </IconButton>
          <a
            href={`/api/download/${photo.id}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/90 transition hover:bg-white/20 active:scale-90"
            aria-label="Download this photo"
            title="Download"
          >
            <DownloadIcon />
          </a>
          <IconButton label="Edit details" onClick={startEditing} active={editing}>
            <EditIcon />
          </IconButton>
          <IconButton
            label="Delete this photo"
            onClick={() => setConfirmDelete(true)}
            hoverClass="hover:bg-red-500/30"
          >
            <TrashIcon />
          </IconButton>
          <IconButton label="Close viewer" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </div>

      {/* Image stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 py-3 sm:px-16">
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
            'max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-opacity duration-300',
            imageLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />
        {!imageLoaded && (
          <div className="absolute h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
        )}
      </div>

      {/* Details / edit panel */}
      <div
        className="shrink-0 border-t border-white/10 bg-black/45 px-4 py-4 sm:px-6"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {editing ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/50">
                  Caption
                </span>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="What was happening here?"
                  className="w-full resize-none rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-white/50">
                    Memory date
                  </span>
                  <input
                    type="date"
                    value={memoryDate}
                    onChange={(e) => setMemoryDate(e.target.value)}
                    className="rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-sm text-white [color-scheme:dark] focus:border-white/40 focus:outline-none"
                  />
                </label>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-full px-4 py-2 text-sm text-white/70 transition hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={busy}
                    className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 text-white">
              {photo.caption && (
                <p className="font-display text-lg leading-snug sm:text-xl">{photo.caption}</p>
              )}
              <p className="text-sm text-white/65">{formatMemoryDate(photo.memory_date)}</p>
              <p className="text-xs text-white/45">
                Uploaded by {photo.uploaderName} · {formatTimestamp(photo.created_at)}
                {photo.favoritedBy.length > 0 && (
                  <>
                    {' · '}
                    <span className="text-accent">
                      Loved by {photo.favoritedBy.join(' & ')}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="animate-fade absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-5">
          <div className="animate-zoom w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-float">
            <h3 className="font-display text-xl">Delete this memory?</h3>
            <p className="mt-2 text-sm text-muted">
              The photo will be removed for both of you. This cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 rounded-full border border-line px-4 py-2.5 text-sm font-medium transition hover:bg-surface-2"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="flex-1 rounded-full bg-danger px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
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
  activeClass = 'bg-accent/25 text-accent',
  hoverClass = 'hover:bg-white/20',
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
        'inline-flex h-10 w-10 items-center justify-center rounded-full transition active:scale-90',
        active ? activeClass : `bg-white/10 text-white/90 ${hoverClass}`,
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
        'absolute top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-90 sm:flex',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      {side === 'left' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
    </button>
  );
}
