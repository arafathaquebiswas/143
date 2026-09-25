#!/usr/bin/env node
/**
 * Sets a password you choose, for one account.
 *
 *   npm run set-password -- arafathaquebiswas@gmail.com
 *
 * You type it twice, hidden. It is verified by actually signing in, then
 * written back into ACCOUNTS.local.txt. It never appears on screen.
 */

import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { bold, dim, green, loadEnv, promptHidden, red } from './env.mjs';

const email = (process.argv[2] ?? '').toLowerCase().trim();
if (!email) {
  console.error(red('\n  Usage: npm run set-password -- <email>\n'));
  process.exit(1);
}

const env = await loadEnv();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const user = list.users.find((u) => (u.email ?? '').toLowerCase() === email);
if (!user) {
  console.error(red(`\n  No account for ${email}.\n`));
  process.exit(1);
}

console.log(bold(`\n  New password for ${email}\n`));
const pw = await promptHidden('  Password (min 8): ');
if (!pw || pw.length < 8) {
  console.error(red('\n  Too short — use at least 8 characters.\n'));
  process.exit(1);
}
const again = await promptHidden('  Type it again:    ');
if (pw !== again) {
  console.error(red('\n  The two did not match. Nothing changed.\n'));
  process.exit(1);
}

const { error } = await admin.auth.admin.updateUserById(user.id, { password: pw });
if (error) {
  console.error(red(`\n  ${error.message}\n`));
  process.exit(1);
}

process.stdout.write('\n  Verifying by signing in… ');
const test = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
const { error: signInError } = await test.auth.signInWithPassword({ email, password: pw });
if (signInError) {
  console.error(red(`failed: ${signInError.message}\n`));
  process.exit(1);
}
await test.auth.signOut();
console.log(green('works.\n'));

try {
  const txt = await readFile('ACCOUNTS.local.txt', 'utf8');
  const updated = txt.replace(
    new RegExp(`(email:\\s*${email.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\n\\s*password:\\s*)\\S+`, 'i'),
    `$1${pw}`,
  );
  await writeFile('ACCOUNTS.local.txt', updated);
  await chmod('ACCOUNTS.local.txt', 0o600);
  console.log(dim('  ACCOUNTS.local.txt updated.\n'));
} catch {
  console.log(dim('  (ACCOUNTS.local.txt not updated — file missing)\n'));
}
