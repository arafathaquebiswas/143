import Link from 'next/link';

import { HeartIcon } from '@/components/icons';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <HeartIcon filled width={24} height={24} />
      </span>
      <h1 className="font-display text-3xl">This page does not exist</h1>
      <p className="mt-2 max-w-xs text-sm text-muted">
        Maybe it was a typo. Everything we have saved is still safe.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover"
      >
        Take me home
      </Link>
    </main>
  );
}
