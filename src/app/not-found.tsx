import Link from 'next/link';

import { HeartIcon } from '@/components/icons';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="animate-breathe mb-6 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-accent/15 to-clay/10 text-accent ring-1 ring-accent/15">
        <HeartIcon filled width={24} height={24} />
      </span>
      <h1 className="display text-[2.25rem] leading-none">This page does not exist</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">
        Maybe it was a typo. Everything we have saved is still safe.
      </p>
      <Link
        href="/"
        className="sheen mt-8 rounded-full bg-gradient-to-br from-accent to-clay px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition-all duration-300"
      >
        Take me home
      </Link>
    </main>
  );
}
