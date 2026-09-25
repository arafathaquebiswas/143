'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-line bg-surface px-6 py-16 text-center shadow-soft">
      <h1 className="font-display text-2xl">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Your photos are safe. This was a problem loading the page, not with anything we saved.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover"
      >
        Try again
      </button>
    </div>
  );
}
