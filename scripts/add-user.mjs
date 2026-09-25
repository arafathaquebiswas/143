#!/usr/bin/env node
/**
 * Creates one of your two accounts and puts it on the allow list, in one go.
 * Replaces steps 4a and 4b of the README — no SQL to copy, nothing to mistype.
 *
 *   npm run add-user -- you@example.com "Your Name"
 *   npm run add-user -- her@example.com "Her Name"
 *
 * It asks for a password without echoing it. Press Enter on an empty prompt and
 * it generates a strong one and shows it once.
 *
 * Re-running for the same email is safe: it updates the display name and, if
 * you give one, the password. Needs SUPABASE_SERVICE_ROLE_KEY in
 * .env.backup.local (Supabase → Project Settings → API → service_role).
 */

import { createClient } from '@supabase/supabase-js';
import { bold, dim, generatePassword, green, loadEnv, promptHidden, red, yellow } from './env.mjs';

const [email, ...nameParts] = process.argv.slice(2);
const displayName = nameParts.join(' ').trim();

if (!email || !displayName) {
  console.error(
    `\n${bold('Usage:')}  npm run add-user -- <email> "<display name>"\n\n` +
      `  npm run add-user -- you@example.com "Arafat"\n` +
      `  npm run add-user -- her@example.com "Her Name"\n`,
  );
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(red(`\n"${email}" is not a valid email address.\n`));
  process.exit(1);
}

const env = await loadEnv();

if (!env.url || !env.serviceKey) {
  console.error(
    `\n${red('Missing credentials.')}\n\n` +
      `  NEXT_PUBLIC_SUPABASE_URL     → .env.local\n` +
      `  SUPABASE_SERVICE_ROLE_KEY    → .env.backup.local\n\n` +
      `Both are on the Supabase dashboard under Project Settings → API.\n` +
      `The service_role key is the secret one — keep it off GitHub and out of Vercel.\n`,
  );
  process.exit(1);
}

const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

// --- Does this person already have a login? --------------------------------
const existing = await findUserByEmail(email);

let password = await promptHidden(
  existing
    ? `New password for ${email} (Enter to leave it unchanged): `
    : `Password for ${email} (Enter to generate one): `,
);

let generated = false;
if (!password) {
  if (existing) {
    password = null; // leave the current password alone
  } else {
    password = generatePassword();
    generated = true;
  }
} else if (password.length < 8) {
  console.error(red('\nPasswords must be at least 8 characters.\n'));
  process.exit(1);
}

// --- Create or update the login --------------------------------------------
let userId;

if (existing) {
  userId = existing.id;
  if (password) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) exit(`Could not update the password: ${error.message}`);
    console.log(dim(`\n  updated password for ${email}`));
  } else {
    console.log(dim(`\n  ${email} already exists — password left unchanged`));
  }
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email to chase
  });
  if (error) exit(`Could not create the account: ${error.message}`);
  userId = data.user.id;
  console.log(dim(`\n  created login for ${email}`));
}

// --- Put them on the allow list --------------------------------------------
const { error: allowError } = await admin
  .from('allowed_users')
  .upsert({ user_id: userId, display_name: displayName }, { onConflict: 'user_id' });

if (allowError) {
  exit(
    `Account exists, but adding it to the allow list failed: ${allowError.message}\n` +
      `  If it says the table does not exist, run supabase/schema.sql first.`,
  );
}

console.log(dim(`  added "${displayName}" to the allow list`));

// --- Report ----------------------------------------------------------------
const { data: roster } = await admin
  .from('allowed_users')
  .select('display_name')
  .order('created_at');

console.log(green(bold(`\n${displayName} can now sign in.\n`)));

if (generated) {
  console.log(`  ${bold('Email')}     ${email}`);
  console.log(`  ${bold('Password')}  ${yellow(password)}`);
  console.log(dim('\n  This is the only time it is shown. Save it now, or change it'));
  console.log(dim('  after signing in from the Settings page.\n'));
}

const names = (roster ?? []).map((p) => p.display_name);
console.log(dim(`  Allow list (${names.length}): ${names.join(', ')}`));
console.log(
  names.length < 2
    ? dim('  Add the second person, then run: npm run doctor\n')
    : dim('  Both accounts are set. Next: npm run doctor, then npm run dev\n'),
);

// ---------------------------------------------------------------------------

/** The admin API has no lookup-by-email, so page through and match. */
async function findUserByEmail(target) {
  const wanted = target.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) exit(`Could not read the user list: ${error.message}`);

    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

function exit(message) {
  console.error(red(`\n${message}\n`));
  process.exit(1);
}
