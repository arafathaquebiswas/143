import { differenceInCalendarDays, format, parseISO } from 'date-fns';

/** Tiny class-name joiner. Keeps conditional Tailwind readable. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** "12 September 2025" */
export function formatMemoryDate(iso: string): string {
  return format(parseISO(iso), 'd MMMM yyyy');
}

/** "Friday, 12 September" */
export function formatDayHeading(iso: string): string {
  return format(parseISO(iso), 'EEEE, d MMMM');
}

/** "September 2025" */
export function formatMonthHeading(iso: string): string {
  return format(parseISO(iso), 'MMMM yyyy');
}

/** "12 Sep 2025, 21:04" — used for upload timestamps. */
export function formatTimestamp(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, HH:mm");
}

/** Today's date as yyyy-MM-dd, in the viewer's own timezone. */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Whole days since the relationship started. Never negative. */
export function daysTogether(startISO: string): number {
  try {
    return Math.max(0, differenceInCalendarDays(new Date(), parseISO(startISO)) + 1);
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
