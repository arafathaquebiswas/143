'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { MONTH_NAMES } from '@/lib/utils';

export default function TimelineFilters({ years }: { years: number[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const year = params.get('year') ?? '';
  const month = params.get('month') ?? '';

  const apply = (next: { year?: string; month?: string }) => {
    const search = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    // A month without a year is meaningless.
    if (!search.get('year')) search.delete('month');

    startTransition(() => {
      const query = search.toString();
      router.push(query ? `/timeline?${query}` : '/timeline');
    });
  };

  // text-base on phones, not text-sm: iOS Safari force-zooms the page when a
  // focused control is under 16px and never zooms back out.
  const selectClass =
    'rounded-full border border-line bg-surface px-4 py-2.5 text-base transition focus:border-accent focus:outline-none disabled:opacity-60 sm:text-sm';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={year}
        disabled={pending || years.length === 0}
        onChange={(e) => apply({ year: e.target.value, month: '' })}
        className={selectClass}
        aria-label="Filter by year"
      >
        <option value="">All years</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>

      <select
        value={month}
        disabled={pending || !year}
        onChange={(e) => apply({ month: e.target.value })}
        className={selectClass}
        aria-label="Filter by month"
      >
        <option value="">All months</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </select>

      {(year || month) && (
        <button
          type="button"
          onClick={() => apply({ year: '', month: '' })}
          className="rounded-full px-3 py-2.5 text-sm text-muted transition hover:text-accent"
        >
          Clear
        </button>
      )}
    </div>
  );
}
