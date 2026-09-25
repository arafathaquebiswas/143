import Link from 'next/link';

import { HeartIcon } from '@/components/icons';

export default function SectionHeader({
  eyebrow,
  title,
  hint,
  href,
  linkLabel = 'See all',
}: {
  eyebrow?: string;
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="tracked mb-2.5 flex items-center gap-2 text-[0.625rem] font-semibold text-accent">
            <HeartIcon filled width={10} height={10} />
            {eyebrow}
          </p>
        )}
        <h2 className="display text-[1.75rem] leading-tight sm:text-[2.125rem]">{title}</h2>
        {hint && <p className="mt-2 text-sm leading-relaxed text-muted">{hint}</p>}
      </div>
      {href && (
        <Link
          href={href}
          className="group shrink-0 whitespace-nowrap rounded-full border border-line/70 bg-surface/60 px-4 py-2.5 text-xs font-medium text-muted backdrop-blur-xl transition-all duration-300 hover:border-accent/40 hover:text-accent"
        >
          {linkLabel}
          <span className="ml-1 inline-block transition-transform duration-300 group-hover:translate-x-0.5">
            &rarr;
          </span>
        </Link>
      )}
    </div>
  );
}
