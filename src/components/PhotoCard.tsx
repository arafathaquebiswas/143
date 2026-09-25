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
  /** 'natural' keeps each photo's own shape, for the masonry layouts. */
  ratio = 'portrait',
}: {
  photo: Photo;
  onOpen: () => void;
  onToggleFavorite: () => void;
  className?: string;
  style?: CSSProperties;
  showMeta?: boolean;
  ratio?: 'portrait' | 'natural' | 'square';
}) {
  const [loaded, setLoaded] = useState(false);
  const [burst, setBurst] = useState(0);

  const heart = () => {
    if (!photo.isFavorite) setBurst((n) => n + 1);
    onToggleFavorite();
  };

  const aspect =
    ratio === 'natural' && photo.width && photo.height
      ? { aspectRatio: `${photo.width} / ${photo.height}` }
      : ratio === 'square'
        ? { aspectRatio: '1 / 1' }
        : { aspectRatio: '4 / 5' };

  return (
    <figure
      className={cn(
        'group relative overflow-hidden rounded-[1.375rem] bg-surface-2 shadow-soft ring-1 ring-line/60 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-float hover:ring-accent/25',
        className,
      )}
      style={style}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={heart}
        className="relative block w-full cursor-zoom-in"
        aria-label={photo.caption ? `Open: ${photo.caption}` : 'Open photo'}
      >
        <div className="relative w-full overflow-hidden" style={aspect}>
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
              'h-full w-full object-cover transition-all duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.06]',
              loaded ? 'scale-100 opacity-100 blur-0' : 'scale-105 opacity-0 blur-md',
            )}
          />

          {/* Caption rises out of the image on hover, Pinterest-style. */}
          {showMeta && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-3.5 pt-12 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
              <p className="line-clamp-2 text-[0.8125rem] font-medium leading-snug text-white">
                {photo.caption || formatMemoryDate(photo.memory_date)}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-white/70">
                {photo.caption ? `${formatMemoryDate(photo.memory_date)} · ` : ''}
                {photo.uploaderName}
              </p>
            </div>
          )}
        </div>
      </button>

      {photo.is_special && (
        <span
          className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/35 px-2.5 py-1 text-[0.625rem] font-semibold tracking-wide text-gold backdrop-blur-md"
          title="A special moment"
        >
          <StarIcon filled width={11} height={11} />
          Special
        </span>
      )}

      <button
        type="button"
        onClick={heart}
        aria-pressed={photo.isFavorite}
        aria-label={photo.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        className={cn(
          'absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-300 active:scale-90',
          photo.isFavorite
            ? 'border-white/30 bg-black/35 text-accent'
            : 'border-white/20 bg-black/25 text-white/85 hover:bg-black/45 hover:text-white md:opacity-0 md:group-hover:opacity-100',
        )}
      >
        <span key={burst} className={burst ? 'animate-pop block' : 'block'}>
          <HeartIcon filled={photo.isFavorite} width={17} height={17} />
        </span>
      </button>
    </figure>
  );
}
