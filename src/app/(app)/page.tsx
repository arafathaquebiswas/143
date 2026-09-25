import Link from 'next/link';
import { redirect } from 'next/navigation';

import PhotoBrowser from '@/components/PhotoBrowser';
import SectionHeader from '@/components/SectionHeader';
import { HeartIcon, StarIcon, UploadIcon } from '@/components/icons';
import { getCounts, getPhotos, getSettings, getViewer } from '@/lib/photos';
import { daysTogether, formatMemoryDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const [settings, counts, special, recent, favorites] = await Promise.all([
    getSettings(),
    getCounts(),
    getPhotos({ specialOnly: true, limit: 4 }),
    getPhotos({ sort: 'created', limit: 12 }),
    getPhotos({ favoritesOnly: true, limit: 12 }),
  ]);

  const days = daysTogether(settings.relationship_start_date);
  const firstName = viewer.displayName.split(' ')[0];

  return (
    <div className="space-y-20 sm:space-y-24">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="animate-reveal relative -mx-5 overflow-hidden px-5 pb-4 pt-6 text-center sm:mx-0 sm:px-0 sm:pt-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-glow),transparent_70%)]"
        />

        <p className="tracked text-[0.625rem] font-semibold text-accent">
          Welcome back, {firstName}
        </p>

        <h1 className="display mx-auto mt-6 max-w-[14ch] text-[2.75rem] leading-[1.02] sm:text-[4rem]">
          {settings.home_title}
        </h1>

        <span className="mx-auto mt-6 flex w-fit items-center gap-3 text-accent/40">
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-accent/30" />
          <HeartIcon filled width={13} height={13} />
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-accent/30" />
        </span>

        {settings.home_quote && (
          <p className="display mx-auto mt-6 max-w-[30ch] text-lg italic leading-relaxed text-muted sm:text-[1.375rem]">
            {settings.home_quote}
          </p>
        )}

        {/* Days together */}
        <div className="mx-auto mt-11 w-fit">
          <div className="card px-10 py-7 shadow-card sm:px-14">
            <p className="rose-text display text-[3.25rem] font-semibold leading-none tabular-nums sm:text-[4.25rem]">
              {days.toLocaleString()}
            </p>
            <p className="tracked mt-3 text-[0.625rem] font-semibold text-muted">
              {days === 1 ? 'day' : 'days'} together
            </p>
            <p className="mt-1.5 text-xs text-muted/70">
              since {formatMemoryDate(settings.relationship_start_date)}
            </p>
          </div>
        </div>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/upload"
            className="sheen inline-flex items-center gap-2.5 rounded-full bg-gradient-to-br from-accent to-clay px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition-all duration-300 hover:shadow-float active:scale-95"
          >
            <UploadIcon width={16} height={16} />
            Add a memory
          </Link>
          <Link
            href="/timeline"
            className="inline-flex items-center gap-2 rounded-full border border-line/70 bg-surface/60 px-7 py-3.5 text-sm font-medium backdrop-blur-xl transition-all duration-300 hover:border-accent/40 hover:text-accent"
          >
            Our timeline
          </Link>
        </div>
      </section>

      {/* ------------------------------------------------------------- Counters */}
      <section className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Memories" value={counts.photos} href="/gallery" />
        <Stat label="Loved" value={counts.favorites} href="/favorites" accent />
        <Stat label="Special" value={counts.special} href="/gallery?special=1" gold />
      </section>

      {/* ------------------------------------------------------ Special moments */}
      {special.length > 0 && (
        <section>
          <SectionHeader
            eyebrow="Special moments"
            title="The ones we keep closest"
            hint="Everything either of us marked with a star."
            href="/gallery?special=1"
          />
          <PhotoBrowser initialPhotos={special} layout="grid" />
        </section>
      )}

      {/* ---------------------------------------------------------- Recent */}
      <section>
        <SectionHeader
          eyebrow="Recently added"
          title="Lately"
          hint="The newest things we saved."
          href="/gallery"
        />
        <PhotoBrowser
          initialPhotos={recent}
          layout="rail"
          emptyTitle="Our album is waiting"
          emptyHint="Upload your first photo and this page will come alive."
        />
      </section>

      {/* -------------------------------------------------------- Favorites */}
      {favorites.length > 0 && (
        <section>
          <SectionHeader
            eyebrow="Loved"
            title="Our favourites"
            hint="Every photo one of us hearted."
            href="/favorites"
          />
          <PhotoBrowser initialPhotos={favorites} layout="rail" />
        </section>
      )}

      {/* ------------------------------------------------------------ Footer */}
      <footer className="pb-6 text-center">
        <span className="hairline mx-auto mb-7 block w-32" />
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          Made for
          <span className="font-medium text-ink">
            {viewer.partner ? `${viewer.displayName} & ${viewer.partner.display_name}` : 'the two of us'}
          </span>
          <span className="text-accent">
            <HeartIcon filled width={12} height={12} />
          </span>
        </p>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  accent = false,
  gold = false,
}: {
  label: string;
  value: number;
  href: string;
  accent?: boolean;
  gold?: boolean;
}) {
  return (
    <Link
      href={href}
      className="card group px-4 py-6 text-center transition-all duration-500 hover:-translate-y-1 hover:shadow-card"
    >
      <span className="mb-2.5 flex justify-center">
        {gold ? (
          <span className="text-gold/70">
            <StarIcon filled width={14} height={14} />
          </span>
        ) : accent ? (
          <span className="text-accent/70">
            <HeartIcon filled width={14} height={14} />
          </span>
        ) : (
          <span className="h-[14px] w-[14px] rounded-full border-2 border-muted/30" />
        )}
      </span>
      <p className="display text-[1.75rem] font-semibold leading-none tabular-nums sm:text-[2.25rem]">
        {value.toLocaleString()}
      </p>
      <p className="tracked mt-2.5 text-[0.5625rem] font-semibold text-muted">{label}</p>
    </Link>
  );
}
