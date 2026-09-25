'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';

import ThemeToggle from '@/components/ThemeToggle';
import { signOutAction } from '@/lib/actions';
import { cn } from '@/lib/utils';
import {
  GalleryIcon,
  HeartIcon,
  HomeIcon,
  SettingsIcon,
  SignOutIcon,
  TimelineIcon,
  UploadIcon,
} from '@/components/icons';

const LINKS = [
  { href: '/', label: 'Home', Icon: HomeIcon },
  { href: '/gallery', label: 'Gallery', Icon: GalleryIcon },
  { href: '/timeline', label: 'Timeline', Icon: TimelineIcon },
  { href: '/favorites', label: 'Favorites', Icon: HeartIcon },
  { href: '/upload', label: 'Upload', Icon: UploadIcon },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

/** Top bar on desktop, thumb-friendly tab bar on phones. */
export default function Nav({ title, name }: { title: string; name: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <HeartIcon filled width={18} height={18} />
            </span>
            <span className="truncate font-display text-lg font-medium tracking-tight">
              {title}
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {LINKS.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors',
                  isActive(pathname, href)
                    ? 'bg-accent-soft text-accent'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                )}
              >
                <Icon width={17} height={17} />
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-2">
            <ThemeToggle />
            <Link
              href="/settings"
              className={cn(
                'hidden h-10 w-10 items-center justify-center rounded-full border border-line bg-surface transition-colors md:inline-flex',
                isActive(pathname, '/settings') ? 'text-accent' : 'text-muted hover:text-accent',
              )}
              aria-label="Settings"
              title={name}
            >
              <SettingsIcon />
            </Link>
            <button
              type="button"
              onClick={() => startTransition(() => void signOutAction())}
              disabled={pending}
              className="hidden h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-danger disabled:opacity-50 md:inline-flex"
              aria-label="Sign out"
              title="Sign out"
            >
              <SignOutIcon />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line/80 bg-bg/90 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-2">
          {LINKS.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors',
                  active ? 'text-accent' : 'text-muted',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-accent-soft',
                  )}
                >
                  <Icon width={19} height={19} />
                </span>
                {label}
              </Link>
            );
          })}
          <Link
            href="/settings"
            aria-current={isActive(pathname, '/settings') ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors',
              isActive(pathname, '/settings') ? 'text-accent' : 'text-muted',
            )}
          >
            <span
              className={cn(
                'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                isActive(pathname, '/settings') && 'bg-accent-soft',
              )}
            >
              <SettingsIcon width={19} height={19} />
            </span>
            You
          </Link>
        </div>
      </nav>
    </>
  );
}
