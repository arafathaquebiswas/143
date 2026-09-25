'use client';

import { useEffect, useState } from 'react';

import { formatMemoryDate } from '@/lib/utils';

/** Whole days from the start date to today, both as local calendar dates. */
function countDays(startISO: string): number | null {
  const [y, m, d] = startISO.split('-').map(Number);
  if (!y || !m || !d) return null;

  const start = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1);
}

/**
 * Counts in the VIEWER's timezone, not the server's.
 *
 * Computed on the server, the number rolled over at the server's midnight
 * (UTC) — which is 6am in Bangladesh — so it read a day behind every night.
 * Doing it in the browser also lets it tick over on its own at local midnight
 * without a reload.
 *
 * The server value paints first so there is no empty flash; the browser then
 * corrects it if the two timezones disagree.
 */
export default function DaysTogether({
  startISO,
  serverDays,
}: {
  startISO: string;
  serverDays: number;
}) {
  const [days, setDays] = useState(serverDays);

  useEffect(() => {
    const update = () => {
      const n = countDays(startISO);
      if (n !== null) setDays(n);
    };

    update();

    // A once-a-minute check costs nothing and survives midnight, a sleeping
    // phone, and daylight-saving changes without any date arithmetic.
    const timer = setInterval(update, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [startISO]);

  return (
    <div className="mx-auto mt-11 w-fit">
      <div className="card px-10 py-7 shadow-card sm:px-14">
        <p className="rose-text display text-[3.25rem] font-semibold leading-none tabular-nums sm:text-[4.25rem]">
          {days.toLocaleString()}
        </p>
        <p className="tracked mt-3 text-[0.625rem] font-semibold text-muted">
          {days === 1 ? 'day' : 'days'} together
        </p>
        <p className="mt-1.5 text-xs text-muted/70">since {formatMemoryDate(startISO)}</p>
      </div>
    </div>
  );
}
