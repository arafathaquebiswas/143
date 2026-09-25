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
  SparkleIcon,
  TimelineIcon,
  UploadIcon,
} from '@/components/icons';

const LINKS = [
  { href: '/', label: 'Home', Icon: HomeIcon },
  { href: '/gallery', label: 'Gallery', Icon: GalleryIcon },
  { href: '/timeline', label: 'Timeline', Icon: TimelineIcon },
  { href: '/recreate', label: 'Someday', Icon: SparkleIcon },
  { href: '/favorites', label: 'Loved', Icon: HeartIcon },
  { href: '/upload', label: 'Add', Icon: UploadIcon },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export default function Nav({ title, name }: { title: string; name: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <>
      <header className="glass sticky top-0 z-30 border-b border-line/60">
        <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center gap-4 px-5 sm:px-8">
          <Link href="/" className="group flex min-w-0 items-center gap-3">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-clay text-white shadow-soft transition-transform duration-500 group-hover:scale-105 group-hover:rotate-3">
              <HeartIcon filled width={18} height={18} />
            </span>
            <span className="display truncate text-[1.35rem] leading-none">{title}</span>
          </Link>

          {/* Floating pill navigation */}
          <nav className="ml-auto hidden items-center rounded-full border border-line/70 bg-surface/60 p-1 backdrop-blur-xl md:flex">
            {LINKS.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'relative flex items-center gap-2 rounded-full px-4 py-2 text-[0.8125rem] font-medium transition-all duration-300',
                    active
                      ? 'bg-gradient-to-br from-accent to-clay text-white shadow-soft'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  <Icon width={16} height={16} />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <ThemeToggle />
            <Link
              href="/settings"
              className={cn(
                'hidden h-10 w-10 items-center justify-center rounded-full border border-line/70 bg-surface/60 backdrop-blur-xl transition-all duration-300 hover:border-accent/40 hover:text-accent md:inline-flex',
                isActive(pathname, '/settings') ? 'text-accent' : 'text-muted',
              )}
              aria-label="Settings"
              title={name}
            >
              <SettingsIcon width={17} height={17} />
            </Link>
            <button
              type="button"
              onClick={() => startTransition(() => void signOutAction())}
              disabled={pending}
              className="hidden h-10 w-10 items-center justify-center rounded-full border border-line/70 bg-surface/60 text-muted backdrop-blur-xl transition-all duration-300 hover:border-danger/40 hover:text-danger disabled:opacity-50 md:inline-flex"
              aria-label="Sign out"
              title="Sign out"
            >
              <SignOutIcon width={17} height={17} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav
        className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line/60 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-between px-1.5">
          {[...LINKS, { href: '/settings', label: 'You', Icon: SettingsIcon }].map(
            ({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex flex-1 flex-col items-center gap-1 pb-2.5 pt-3 text-[0.625rem] font-medium tracking-wide transition-colors duration-300',
                    active ? 'text-accent' : 'text-muted',
                  )}
                >
                  {active && (
                    <span className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-accent to-transparent" />
                  )}
                  <span
                    className={cn(
                      'flex h-7 w-7 items-center justify-center transition-transform duration-300',
                      active && 'scale-110',
                    )}
                  >
                    <Icon width={20} height={20} />
                  </span>
                  {label}
                </Link>
              );
            },
          )}
        </div>
      </nav>
    </>
  );
}
