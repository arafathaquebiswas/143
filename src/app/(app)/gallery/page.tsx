import Link from 'next/link';

import PageHeading from '@/components/PageHeading';
import PhotoBrowser from '@/components/PhotoBrowser';
import { PAGE_SIZE } from '@/lib/constants';
import { getPhotos } from '@/lib/photos';
import { cn } from '@/lib/utils';
import type { PhotoFilter } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gallery' };

type Search = { special?: string; sort?: string };

export default async function GalleryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const specialOnly = params.special === '1';
  const sort: PhotoFilter['sort'] = params.sort === 'created' ? 'created' : 'memory';

  const filter: PhotoFilter = { specialOnly, sort, limit: PAGE_SIZE };
  const photos = await getPhotos(filter);

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Everything we have saved"
        title={specialOnly ? 'Special moments' : 'Our gallery'}
        hint="Tap any photo to open it full screen."
      />

      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <Chip href="/gallery" active={!specialOnly && sort === 'memory'}>
          By memory date
        </Chip>
        <Chip href="/gallery?sort=created" active={!specialOnly && sort === 'created'}>
          Recently added
        </Chip>
        <Chip href="/gallery?special=1" active={specialOnly}>
          Special only
        </Chip>
      </div>

      <PhotoBrowser
        initialPhotos={photos}
        filter={filter}
        layout="masonry"
        loadMore
        emptyTitle={specialOnly ? 'No special moments yet' : 'The album is empty'}
        emptyHint={
          specialOnly
            ? 'Open any photo and tap the star to keep it here.'
            : 'Upload your first photos and they will appear right here.'
        }
      />
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-5 py-2.5 text-[0.8125rem] font-medium transition-all duration-300',
        active
          ? 'border-transparent bg-gradient-to-br from-accent to-clay text-white shadow-soft'
          : 'border-line/70 bg-surface/60 text-muted backdrop-blur-xl hover:border-accent/40 hover:text-ink',
      )}
    >
      {children}
    </Link>
  );
}
