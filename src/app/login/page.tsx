import { Suspense } from 'react';

import LoginForm from '@/components/LoginForm';
import ThemeToggle from '@/components/ThemeToggle';
import { HeartIcon } from '@/components/icons';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-14">
      <div className="absolute right-5 top-5 z-10">
        <ThemeToggle />
      </div>

      {/* Faint hearts drifting in the background */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {[
          { left: '12%', top: '18%', s: 18, d: '0s' },
          { left: '84%', top: '24%', s: 13, d: '1.6s' },
          { left: '22%', top: '76%', s: 11, d: '3.2s' },
          { left: '78%', top: '70%', s: 16, d: '2.2s' },
          { left: '50%', top: '8%', s: 10, d: '4s' },
        ].map((h, i) => (
          <span
            key={i}
            className="animate-breathe absolute text-accent/10"
            style={{ left: h.left, top: h.top, animationDelay: h.d }}
          >
            <HeartIcon filled width={h.s} height={h.s} />
          </span>
        ))}
      </div>

      <div className="animate-reveal relative w-full max-w-[25rem]">
        <div className="mb-9 text-center">
          <span className="mx-auto mb-6 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-accent to-clay text-white shadow-glow">
            <HeartIcon filled width={30} height={30} />
          </span>
          <h1 className="display text-[2.5rem] leading-none">Our Little World</h1>
          <p className="mx-auto mt-4 max-w-[17rem] text-sm leading-relaxed text-muted">
            A private album for two. Please sign in to come inside.
          </p>
        </div>

        <div className="card p-7 shadow-float sm:p-8">
          <Suspense fallback={<div className="skeleton h-[19rem] rounded-2xl" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mx-auto mt-7 max-w-[20rem] text-center text-xs leading-relaxed text-muted/80">
          There is no sign-up here. Only two accounts exist, and they were created by hand.
        </p>
      </div>
    </main>
  );
}
