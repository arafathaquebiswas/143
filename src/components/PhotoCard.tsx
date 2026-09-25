'use client';

import { useState, type CSSProperties } from 'react';

import { HeartIcon, StarIcon } from '@/components/icons';
import type { Photo } from '@/lib/types';
import { cn, formatMemoryDate } from '@/lib/utils';

export default function PhotoCard({
  photo,
  onOpen,
  onToggleFavorite,
  className,
  style,
  showMeta = true,
}: {
  photo: Photo;
  onOpen: () => void;
  onToggleFavorite: () => void;
  className?: string;
  style?: CSSProperties;
  showMeta?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [burst, setBurst] = useState(0);

  const heart = () => {
    if (!photo.isFavorite) setBurst((n) => n + 1);
    onToggleFavorite();
  };

  return (
    <figure
      className={cn(
        'group relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-float',
        className,
      )}
      style={style}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={heart}
        className="relative block w-full cursor-zoom-in overflow-hidden"
        aria-label={photo.caption ? `Open: ${photo.caption}` : 'Open photo'}
      >
        <div className="relative aspect-4/5 w-full overflow-hidden bg-surface-2">
          {!loaded && <div className="skeleton absolute inset-0" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.thumbUrl}
            alt={photo.caption ?? `Memory from ${formatMemoryDate(photo.memory_date)}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
            className={cn(
              'h-full w-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-[1.04]',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        </div>
      </button>

      {photo.is_special && (
        <span
          className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-gold-soft/95 px-2.5 py-1 text-[11px] font-medium text-gold shadow-soft backdrop-blur-sm"
          title="A special moment"
        >
          <StarIcon filled width={12} height={12} />
          Special
        </span>
      )}

      <button
        type="button"
        onClick={heart}
        aria-pressed={photo.isFavorite}
        aria-label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        className={cn(
          'absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-[color,background-color,transform] active:scale-90',
          photo.isFavorite
            ? 'bg-white/90 text-accent dark:bg-black/55'
            : 'bg-black/25 text-white/90 hover:text-white md:opacity-0 md:group-hover:opacity-100',
        )}
      >
        <span key={burst} className={burst ? 'animate-pop' : undefined}>
          <HeartIcon filled={photo.isFavorite} width={18} height={18} />
        </span>
      </button>

      {showMeta && (
        <figcaption className="space-y-1 px-3.5 py-3">
          <p className="line-clamp-1 text-sm font-medium text-ink">
            {photo.caption || formatMemoryDate(photo.memory_date)}
          </p>
          <p className="line-clamp-1 text-xs text-muted">
            {photo.caption ? `${formatMemoryDate(photo.memory_date)} · ` : ''}
            {photo.uploaderName}
          </p>
        </figcaption>
      )}
    </figure>
  );
}
