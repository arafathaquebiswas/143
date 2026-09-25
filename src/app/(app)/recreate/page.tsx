import Link from 'next/link';

import InspirationBrowser from '@/components/InspirationBrowser';
import PageHeading from '@/components/PageHeading';
import { PAGE_SIZE } from '@/lib/constants';
import { getPhotos } from '@/lib/photos';
import { cn } from '@/lib/utils';
import type { PhotoFilter } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recreate Someday' };

type Search = { done?: string };

export default async function RecreatePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { done } = await searchParams;
  const showingRecreated = done === '1';

  const filter: PhotoFilter = {
    collection: 'inspiration',
    pendingOnly: !showingRecreated,
    sort: 'created',
    limit: PAGE_SIZE,
  };
  const items = await getPhotos(filter);

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Recreate Someday"
        title={showingRecreated ? 'Ones we recreated' : 'Things we want to recreate'}
        hint="Pictures we love and would like to make our own one day."
      />

      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <Chip href="/recreate" active={!showingRecreated}>
          Want to recreate
        </Chip>
        <Chip href="/recreate?done=1" active={showingRecreated}>
          Recreated
        </Chip>
      </div>

      <InspirationBrowser
        initialPhotos={items}
        filter={filter}
        emptyTitle={showingRecreated ? 'Nothing recreated yet' : 'No inspirations yet'}
        emptyHint={
          showingRecreated
            ? 'Once you recreate one of your inspirations it will appear here, next to the original.'
            : 'Save a picture you would like the two of you to recreate one day.'
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
