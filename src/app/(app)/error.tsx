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
    <div className="card flex flex-col items-center justify-center px-7 py-20 text-center">
      <h1 className="display text-2xl">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Your photos are safe. This was a problem loading the page, not with anything we saved.
      </p>
      <button
        type="button"
        onClick={reset}
        className="sheen mt-7 rounded-full bg-gradient-to-br from-accent to-clay px-7 py-3.5 text-sm font-semibold text-white shadow-glow transition-all duration-300"
      >
        Try again
      </button>
    </div>
  );
}
