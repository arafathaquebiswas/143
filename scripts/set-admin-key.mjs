#!/usr/bin/env node
/**
 * Stores the project's service-role key locally so the admin scripts can work.
 *
 *   npm run set-key
 *
 * The key is typed into YOUR terminal, hidden from the screen, and written to
 * .env.backup.local — which is git-ignored and chmod 600. It is never printed,
 * never committed, and never sent anywhere except your own Supabase project.
 */

import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { bold, dim, green, loadEnv, promptHidden, red, yellow } from './env.mjs';

const env = await loadEnv(['.env.local']);

if (!env.url) {
  console.error(red('\n  NEXT_PUBLIC_SUPABASE_URL is not set in .env.local.\n'));
  process.exit(1);
}

const ref = env.url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? 'your-project';
const KEY_URL = `https://supabase.com/dashboard/project/${ref}/settings/api-keys`;

console.log(bold('\nStore the service-role key locally\n'));
console.log(`  1. Opening: ${dim(KEY_URL)}`);
console.log(`  2. Find ${bold('service_role')} (or ${bold('secret')}) and click to reveal, then copy.`);
console.log(`  3. Paste below. ${dim('(Hidden. Written only to .env.backup.local on this Mac.)')}\n`);

try {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  const { execFile } = await import('node:child_process');
  execFile(opener, [KEY_URL], () => {});
} catch { /* the URL is printed above */ }

const key = (await promptHidden('  service_role key: '))?.trim();

if (!key) {
  console.error(red('\n  Nothing entered. Run `npm run set-key` again when ready.\n'));
  process.exit(1);
}

if (key === env.anonKey) {
  console.error(red('\n  That is the publishable/anon key, not the service_role key.\n'));
  console.error(dim('  They are on the same page — service_role is the hidden one.\n'));
  process.exit(1);
}

if (!/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[A-Za-z0-9_-]{20,})$/.test(key)) {
  console.error(red(`\n  That does not look like a service-role key.\n`));
  console.error(dim(`  Expected a JWT starting "eyJ" or a key starting "sb_secret_".`));
  console.error(dim(`  You pasted ${key.length} characters starting "${key.slice(0, 4)}".\n`));
  process.exit(1);
}

// --- Prove it works before writing anything ---------------------------------
process.stdout.write('  Verifying… ');

const admin = createClient(env.url, key, { auth: { persistSession: false } });
try {
  const { error } = await admin.from('allowed_users').select('user_id').limit(1);
  if (error) throw new Error(error.message);
  const { error: bucketError } = await admin.storage.listBuckets();
  if (bucketError) throw new Error(bucketError.message);
} catch (e) {
  console.error(red('failed.\n'));
  console.error(dim(`  ${e.message}\n`));
  console.error(`  ${yellow('Most likely:')} wrong key, or copied only part of it.\n`);
  process.exit(1);
}

console.log(green('valid.\n'));

// --- Write it, owner-readable only ------------------------------------------
let existing = '';
try {
  existing = await readFile('.env.backup.local', 'utf8');
} catch { /* first run */ }

const kept = existing
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('SUPABASE_SERVICE_ROLE_KEY') && !l.startsWith('NEXT_PUBLIC_SUPABASE_'));

await writeFile(
  '.env.backup.local',
  [
    '# Admin key for local scripts only. Git-ignored. Never deploy this.',
    `NEXT_PUBLIC_SUPABASE_URL=${env.url}`,
    `SUPABASE_SERVICE_ROLE_KEY=${key}`,
    ...kept,
    '',
  ].join('\n'),
);
await chmod('.env.backup.local', 0o600);

console.log(dim('  Written to .env.backup.local (owner-only, git-ignored).'));
console.log(green(bold('\n  Done. Tell Claude and it will continue.\n')));
console.log(dim(`  To revoke later: ${KEY_URL} -> rotate the service_role key,`));
console.log(dim('  then delete .env.backup.local.\n'));
