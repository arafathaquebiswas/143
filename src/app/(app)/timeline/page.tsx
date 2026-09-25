import { Suspense } from 'react';

import PhotoBrowser from '@/components/PhotoBrowser';
import TimelineFilters from '@/components/TimelineFilters';
import PageHeading from '@/components/PageHeading';
import { PAGE_SIZE } from '@/lib/constants';
import { getPhotos, getYearsWithMemories } from '@/lib/photos';
import type { PhotoFilter } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Timeline' };

type Search = { year?: string; month?: string };

export default async function TimelinePage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const year = toNumber(params.year, 1900, 2999);
  const month = year ? toNumber(params.month, 1, 12) : undefined;

  const filter: PhotoFilter = { year, month, sort: 'memory', limit: PAGE_SIZE };
  const [photos, years] = await Promise.all([getPhotos(filter), getYearsWithMemories()]);

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Month by month"
        title="Our story"
        hint="Everything in order, newest first."
      />

      <Suspense fallback={<div className="skeleton h-12 w-64 rounded-full" />}>
        <TimelineFilters years={years} />
      </Suspense>

      <PhotoBrowser
        initialPhotos={photos}
        filter={filter}
        layout="timeline"
        loadMore
        emptyTitle="Nothing from this time"
        emptyHint="Try a different month or year, or add photos from back then."
      />
    </div>
  );
}

function toNumber(value: string | undefined, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}
