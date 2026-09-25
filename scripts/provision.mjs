#!/usr/bin/env node
/**
 * Brings the project's accounts to exactly the intended state:
 *   - removes any account that is not one of the two owners
 *   - creates the two owner accounts (confirmed, strong generated passwords)
 *   - puts exactly those two on the allow list
 *
 *   npm run provision -- you@example.com "Your Name" her@example.com "Her Name"
 *
 * Passwords are written to ACCOUNTS.local.txt (chmod 600, git-ignored) and are
 * never printed to the terminal, so they cannot end up in a transcript.
 */

import { chmod, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { bold, dim, generatePassword, green, loadEnv, red, yellow } from './env.mjs';

const args = process.argv.slice(2);
if (args.length !== 4) {
  console.error(red('\n  Usage: npm run provision -- <email1> "<name1>" <email2> "<name2>"\n'));
  process.exit(1);
}
const owners = [
  { email: args[0].toLowerCase().trim(), name: args[1].trim() },
  { email: args[2].toLowerCase().trim(), name: args[3].trim() },
];

const env = await loadEnv();
if (!env.url || !env.serviceKey) {
  console.error(red('\n  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n'));
  process.exit(1);
}

const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
const created = [];

console.log(bold('\nProvisioning accounts\n'));

// --- 1. Every existing auth user ------------------------------------------
const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) {
  console.error(red(`  Could not list users: ${listError.message}\n`));
  process.exit(1);
}

const ownerEmails = new Set(owners.map((o) => o.email));

// --- 2. Remove anyone who is not an owner ---------------------------------
for (const user of list.users) {
  const email = (user.email ?? '').toLowerCase();
  if (ownerEmails.has(email)) continue;

  const { error } = await admin.auth.admin.deleteUser(user.id);
  console.log(
    error
      ? red(`  could not remove ${email}: ${error.message}`)
      : `  ${yellow('removed')} stray account ${email}`,
  );
}

// --- 3. Create or reset each owner ----------------------------------------
for (const owner of owners) {
  const existing = list.users.find((u) => (u.email ?? '').toLowerCase() === owner.email);
  const password = generatePassword(20);

  let userId;
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) {
      console.error(red(`  ${owner.email}: ${error.message}`));
      process.exit(1);
    }
    userId = existing.id;
    console.log(`  ${green('reset')}   ${owner.email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: owner.email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.error(red(`  ${owner.email}: ${error.message}`));
      process.exit(1);
    }
    userId = data.user.id;
    console.log(`  ${green('created')} ${owner.email}`);
  }

  const { error: allowError } = await admin
    .from('allowed_users')
    .upsert({ user_id: userId, display_name: owner.name }, { onConflict: 'user_id' });
  if (allowError) {
    console.error(red(`  allow list for ${owner.email}: ${allowError.message}`));
    process.exit(1);
  }
  console.log(`  ${green('allowed')} ${owner.name}`);

  created.push({ ...owner, userId, password });
}

// --- 4. Strip anyone else off the allow list ------------------------------
const keepIds = created.map((c) => c.userId);
const { data: roster } = await admin.from('allowed_users').select('user_id, display_name');
for (const row of roster ?? []) {
  if (keepIds.includes(row.user_id)) continue;
  await admin.from('allowed_users').delete().eq('user_id', row.user_id);
  console.log(`  ${yellow('removed')} ${row.display_name} from the allow list`);
}

// --- 5. Write credentials where only the owner can read them --------------
const body = [
  'Our Little World — account credentials',
  `Generated ${new Date().toISOString()}`,
  '',
  'Change these from the Settings page after your first sign-in.',
  'This file is git-ignored. Delete it once the passwords are in your password manager.',
  '',
  ...created.flatMap((c) => [
    `${c.name}`,
    `  email:    ${c.email}`,
    `  password: ${c.password}`,
    `  user id:  ${c.userId}`,
    '',
  ]),
].join('\n');

await writeFile('ACCOUNTS.local.txt', body);
await chmod('ACCOUNTS.local.txt', 0o600);

// --- 6. Report, without printing a single password ------------------------
const { data: finalRoster } = await admin
  .from('allowed_users')
  .select('user_id, display_name')
  .order('created_at');
const { data: finalUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });

console.log(bold('\nFinal state'));
console.log(`  auth accounts: ${finalUsers.users.length}`);
for (const u of finalUsers.users) console.log(`    ${u.email}  ${dim(u.id)}`);
console.log(`  allow list:    ${finalRoster.length}`);
for (const p of finalRoster) console.log(`    ${p.display_name}  ${dim(p.user_id)}`);

const ok = finalUsers.users.length === 2 && finalRoster.length === 2;
console.log(ok ? green(bold('\n  Exactly two accounts, both allow-listed.\n')) : red(bold('\n  Unexpected count — check above.\n')));
console.log(dim('  Passwords: cat ACCOUNTS.local.txt   (not shown here on purpose)\n'));
