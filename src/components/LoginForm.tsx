'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { HeartIcon } from '@/components/icons';
import { signInAction, type ActionResult } from '@/lib/actions';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(signInAction, null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : '/');
      router.refresh();
    }
  }, [state, params, router]);

  const field =
    'w-full rounded-2xl border border-line bg-bg/60 px-4 py-3.5 text-base transition-all duration-300 placeholder:text-muted/50 focus:border-accent/50 focus:bg-bg focus:outline-none focus:ring-4 focus:ring-[var(--ring)]';

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="tracked mb-2.5 block text-[0.625rem] font-semibold text-muted">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          placeholder="you@example.com"
          className={field}
        />
      </label>

      <label className="block">
        <span className="tracked mb-2.5 block text-[0.625rem] font-semibold text-muted">Password</span>
        <div className="relative">
          <input
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={`${field} pr-16`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-muted transition-colors hover:text-accent"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      {state && !state.ok && (
        <p role="alert" className="animate-reveal rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="sheen mt-2 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-br from-accent to-clay px-4 py-4 text-sm font-semibold tracking-wide text-white shadow-glow transition-all duration-300 hover:shadow-float active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? (
          'Opening…'
        ) : (
          <>
            <HeartIcon filled width={15} height={15} />
            Come in
          </>
        )}
      </button>
    </form>
  );
}
