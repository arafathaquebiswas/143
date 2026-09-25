'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { HeartIcon } from '@/components/icons';
import { signInAction, type ActionResult } from '@/lib/actions';

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    signInAction,
    null,
  );
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : '/');
      router.refresh();
    }
  }, [state, params, router]);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          className="w-full rounded-xl border border-line bg-bg px-4 py-3 text-base transition focus:border-accent focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
          Password
        </span>
        <div className="relative">
          <input
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="w-full rounded-xl border border-line bg-bg py-3 pl-4 pr-16 text-base transition focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted transition hover:text-accent"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      {state && !state.ok && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-contrast shadow-soft transition hover:bg-accent-hover active:scale-[0.99] disabled:opacity-60"
      >
        {pending ? (
          'Opening…'
        ) : (
          <>
            <HeartIcon filled width={16} height={16} />
            Come in
          </>
        )}
      </button>
    </form>
  );
}
