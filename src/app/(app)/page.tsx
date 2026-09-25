import Link from 'next/link';
import { redirect } from 'next/navigation';

import PhotoBrowser from '@/components/PhotoBrowser';
import SectionHeader from '@/components/SectionHeader';
import { HeartIcon, UploadIcon } from '@/components/icons';
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
    <div className="space-y-14">
      {/* Hero */}
      <section className="animate-rise relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface px-6 py-12 text-center shadow-soft sm:px-10 sm:py-16">
        <FloatingHearts />

        <p className="relative text-xs font-medium uppercase tracking-[0.2em] text-muted">
          Welcome back, {firstName}
        </p>

        <h1 className="relative mt-4 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          {settings.home_title}
          <span className="ml-2 inline-block align-middle text-accent">
            <HeartIcon filled width={30} height={30} />
          </span>
        </h1>

        {settings.home_quote && (
          <p className="relative mx-auto mt-5 max-w-md font-display text-lg italic leading-relaxed text-muted sm:text-xl">
            &ldquo;{settings.home_quote}&rdquo;
          </p>
        )}

        <div className="relative mx-auto mt-9 inline-flex flex-col items-center rounded-2xl border border-line bg-bg-tint px-8 py-5">
          <span className="font-display text-4xl font-semibold tabular-nums text-accent sm:text-5xl">
            {days.toLocaleString()}
          </span>
          <span className="mt-1 text-sm text-muted">
            {days === 1 ? 'day' : 'days'} together
          </span>
          <span className="mt-0.5 text-xs text-muted/70">
            since {formatMemoryDate(settings.relationship_start_date)}
          </span>
        </div>

        <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-contrast shadow-soft transition hover:bg-accent-hover active:scale-95"
          >
            <UploadIcon width={17} height={17} />
            Add a memory
          </Link>
          <Link
            href="/timeline"
            className="inline-flex items-center gap-2 rounded-full border border-line px-6 py-3 text-sm font-medium transition hover:border-accent hover:text-accent"
          >
            Our timeline
          </Link>
        </div>
      </section>

      {/* Counters */}
      <section className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Memories" value={counts.photos} href="/gallery" />
        <Stat label="Loved" value={counts.favorites} href="/favorites" />
        <Stat label="Special" value={counts.special} href="/gallery?special=1" />
      </section>

      {/* Special moments */}
      {special.length > 0 && (
        <section>
          <SectionHeader
            emoji="💌"
            title="Special Moments"
            hint="The ones we never want to forget."
            href="/gallery?special=1"
          />
          <PhotoBrowser initialPhotos={special} layout="grid" />
        </section>
      )}

      {/* Recent */}
      <section>
        <SectionHeader
          emoji="📸"
          title="Recent Photos"
          hint="The latest things we added."
          href="/gallery"
        />
        <PhotoBrowser
          initialPhotos={recent}
          layout="rail"
          emptyTitle="Our album is waiting"
          emptyHint="Upload your first photo and this page will come alive."
        />
      </section>

      {/* Favorites */}
      {favorites.length > 0 && (
        <section>
          <SectionHeader
            emoji="⭐"
            title="Favorite Memories"
            hint="Everything either of us hearted."
            href="/favorites"
          />
          <PhotoBrowser initialPhotos={favorites} layout="rail" />
        </section>
      )}

      <p className="pb-4 text-center text-sm text-muted">
        Made for {viewer.partner ? `${viewer.displayName} & ${viewer.partner.display_name}` : 'the two of us'}
        <span className="mx-1.5 inline-block align-middle text-accent">
          <HeartIcon filled width={13} height={13} />
        </span>
      </p>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-5 text-center shadow-soft transition hover:-translate-y-0.5 hover:shadow-float"
    >
      <p className="font-display text-2xl font-semibold tabular-nums sm:text-3xl">
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-muted sm:text-sm">{label}</p>
    </Link>
  );
}

/** A few very faint hearts drifting behind the hero text. */
function FloatingHearts() {
  const hearts = [
    { left: '8%', top: '18%', size: 14, delay: '0s' },
    { left: '88%', top: '26%', size: 11, delay: '1.1s' },
    { left: '18%', top: '72%', size: 10, delay: '2.2s' },
    { left: '78%', top: '68%', size: 13, delay: '0.6s' },
  ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {hearts.map((h, i) => (
        <span
          key={i}
          className="absolute text-accent/15"
          style={{ left: h.left, top: h.top, animation: `rise 3s ease-in-out ${h.delay} infinite alternate` }}
        >
          <HeartIcon filled width={h.size} height={h.size} />
        </span>
      ))}
    </div>
  );
}
