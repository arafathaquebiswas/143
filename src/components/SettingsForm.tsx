'use client';

import { useActionState, useTransition } from 'react';

import { SignOutIcon } from '@/components/icons';
import {
  changePasswordAction,
  signOutAction,
  updateSettingsAction,
  type ActionResult,
} from '@/lib/actions';
import type { AppSettings } from '@/lib/types';

export default function SettingsForm({
  settings,
  displayName,
  email,
}: {
  settings: AppSettings;
  displayName: string;
  email: string;
}) {
  const [saveState, saveAction, saving] = useActionState<ActionResult | null, FormData>(
    updateSettingsAction,
    null,
  );
  const [pwState, pwAction, changingPassword] = useActionState<ActionResult | null, FormData>(
    changePasswordAction,
    null,
  );
  const [signingOut, startSignOut] = useTransition();

  const field =
    'w-full rounded-2xl border border-line bg-bg/60 px-4 py-3.5 text-base transition-all duration-300 placeholder:text-muted/50 focus:border-accent/50 focus:bg-bg focus:outline-none focus:ring-4 focus:ring-[var(--ring)]';
  const labelText = 'tracked mb-2.5 block text-[0.625rem] font-semibold text-muted';

  return (
    <div className="space-y-6">
      <form
        action={saveAction}
        className="card space-y-6 p-6 sm:p-8"
      >
        <div>
          <h2 className="display text-2xl">Our little world</h2>
          <p className="mt-1 text-sm text-muted">
            These settings change the homepage for both of you.
          </p>
        </div>

        <label className="block">
          <span className={labelText}>The day it all started</span>
          <input
            type="date"
            name="relationship_start_date"
            defaultValue={settings.relationship_start_date}
            required
            className={field}
          />
          <span className="mt-1.5 block text-xs text-muted">
            The &ldquo;days together&rdquo; counter is worked out from this date.
          </span>
        </label>

        <label className="block">
          <span className={labelText}>Album title</span>
          <input
            type="text"
            name="home_title"
            defaultValue={settings.home_title}
            maxLength={60}
            required
            className={field}
          />
        </label>

        <label className="block">
          <span className={labelText}>Words for the homepage</span>
          <textarea
            name="home_quote"
            defaultValue={settings.home_quote}
            maxLength={200}
            rows={2}
            className={`${field} resize-none`}
          />
        </label>

        <label className="block">
          <span className={labelText}>Your name</span>
          <input
            type="text"
            name="display_name"
            defaultValue={displayName}
            maxLength={40}
            required
            className={field}
          />
          <span className="mt-1.5 block text-xs text-muted">
            Shown as &ldquo;uploaded by&rdquo; on your photos.
          </span>
        </label>

        <Feedback state={saveState} okText="Saved." />

        <button
          type="submit"
          disabled={saving}
          className="sheen w-full rounded-2xl bg-gradient-to-br from-accent to-clay px-4 py-3.5 text-sm font-semibold text-white shadow-glow transition-all duration-300 hover:shadow-float active:scale-[0.99] disabled:opacity-60 sm:w-auto sm:px-9"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <form
        action={pwAction}
        className="card space-y-6 p-6 sm:p-8"
      >
        <div>
          <h2 className="display text-2xl">Change your password</h2>
          <p className="mt-1 text-sm text-muted">Signed in as {email}</p>
        </div>

        <label className="block">
          <span className={labelText}>New password</span>
          <input
            type="password"
            name="new_password"
            autoComplete="new-password"
            minLength={8}
            required
            className={field}
          />
        </label>

        <label className="block">
          <span className={labelText}>Type it again</span>
          <input
            type="password"
            name="confirm_password"
            autoComplete="new-password"
            minLength={8}
            required
            className={field}
          />
        </label>

        <Feedback state={pwState} okText="Password updated." />

        <button
          type="submit"
          disabled={changingPassword}
          className="w-full rounded-2xl border border-line px-4 py-3.5 text-sm font-medium transition-all duration-300 hover:border-accent/50 hover:text-accent disabled:opacity-60 sm:w-auto sm:px-9"
        >
          {changingPassword ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => startSignOut(() => void signOutAction())}
        disabled={signingOut}
        className="card flex w-full items-center justify-center gap-2.5 px-4 py-4.5 text-sm font-medium text-muted transition-all duration-300 hover:border-danger/40 hover:text-danger disabled:opacity-60"
      >
        <SignOutIcon width={17} height={17} />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}

function Feedback({ state, okText }: { state: ActionResult | null; okText: string }) {
  if (!state) return null;
  return state.ok ? (
    <p className="animate-reveal rounded-2xl border border-accent/20 bg-accent-soft px-4 py-3.5 text-sm text-accent">{okText}</p>
  ) : (
    <p role="alert" className="animate-reveal rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3.5 text-sm text-danger">
      {state.error}
    </p>
  );
}
