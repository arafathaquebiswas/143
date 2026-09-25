import Link from 'next/link';

export default function SectionHeader({
  emoji,
  title,
  hint,
  href,
  linkLabel = 'See all',
}: {
  emoji: string;
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 font-display text-2xl sm:text-3xl">
          <span aria-hidden className="text-xl sm:text-2xl">
            {emoji}
          </span>
          {title}
        </h2>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 rounded-full border border-line px-4 py-2 text-sm text-muted transition hover:border-accent hover:text-accent"
        >
          {linkLabel}
        </Link>
      )}
    </div>
  );
}
