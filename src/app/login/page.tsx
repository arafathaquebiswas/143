import { Suspense } from 'react';

import LoginForm from '@/components/LoginForm';
import ThemeToggle from '@/components/ThemeToggle';
import { HeartIcon } from '@/components/icons';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="animate-rise w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent">
            <HeartIcon filled width={28} height={28} />
          </span>
          <h1 className="font-display text-3xl font-medium tracking-tight">Our Little World</h1>
          <p className="mt-2 text-sm text-muted">
            A private album for two. Please sign in to come inside.
          </p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-float">
          <Suspense fallback={<div className="skeleton h-72 rounded-xl" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          There is no sign-up here. Only two accounts exist, and they were created by hand.
        </p>
      </div>
    </main>
  );
}
