import Link from 'next/link';

import PhotoBrowser from '@/components/PhotoBrowser';
import { PAGE_SIZE } from '@/lib/constants';
import { getPhotos } from '@/lib/photos';
import { cn } from '@/lib/utils';
import type { PhotoFilter } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gallery' };

type Search = { special?: string; sort?: string };

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const specialOnly = params.special === '1';
  const sort: PhotoFilter['sort'] = params.sort === 'created' ? 'created' : 'memory';

  const filter: PhotoFilter = { specialOnly, sort, limit: PAGE_SIZE };
  const photos = await getPhotos(filter);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl">Our Memories</h1>
        <p className="mt-1.5 text-sm text-muted">
          Everything we have saved, in one place. Tap a photo to open it.
        </p>
      </header>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Chip href="/gallery" active={!specialOnly && sort === 'memory'}>
          By memory date
        </Chip>
        <Chip
          href="/gallery?sort=created"
          active={!specialOnly && sort === 'created'}
        >
          Recently added
        </Chip>
        <Chip href="/gallery?special=1" active={specialOnly}>
          ⭐ Special only
        </Chip>
      </div>

      <PhotoBrowser
        initialPhotos={photos}
        filter={filter}
        layout="grid"
        loadMore
        emptyTitle={specialOnly ? 'No special moments yet' : 'The album is empty'}
        emptyHint={
          specialOnly
            ? 'Open any photo and tap the star to mark it as special.'
            : 'Upload your first photos and they will show up right here.'
        }
      />
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-surface text-muted hover:text-ink',
      )}
    >
      {children}
    </Link>
  );
}
