#!/usr/bin/env node
/**
 * Connects the Supabase CLI to your account in one step.
 *
 *   npm run connect
 *
 * Opens the token page in your browser, takes the token without echoing it to
 * the screen, hands it to the CLI, and confirms it worked. The token is stored
 * by the Supabase CLI in your own config — it is never written to this project
 * and never leaves your machine.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bold, dim, green, promptHidden, red, yellow } from './env.mjs';

const run = promisify(execFile);
const SUPABASE = ['--yes', 'supabase@2.117.0'];
const TOKEN_URL = 'https://supabase.com/dashboard/account/tokens';

async function supabase(args, opts = {}) {
  return run('npx', [...SUPABASE, ...args], { maxBuffer: 10 * 1024 * 1024, ...opts });
}

// --- Already connected? -----------------------------------------------------
try {
  await supabase(['projects', 'list']);
  console.log(green(bold('\nAlready connected to Supabase.\n')));
  console.log(dim('  Nothing to do. Next: npm run doctor\n'));
  process.exit(0);
} catch {
  // Not logged in — carry on.
}

console.log(bold('\nConnect the Supabase CLI\n'));
console.log(`  1. A browser tab is opening at:\n     ${dim(TOKEN_URL)}`);
console.log(`  2. Click ${bold('Generate new token')}, give it any name, and copy it.`);
console.log(`  3. Paste it below. ${dim('(It will not appear on screen.)')}\n`);

// Best effort — if the browser does not open, the URL is printed above anyway.
try {
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  await run(opener, [TOKEN_URL]);
} catch {
  // Nothing to do; the user has the URL.
}

const token = (await promptHidden('  Access token: '))?.trim();

if (!token) {
  console.error(red('\n  No token entered. Run `npm run connect` again when ready.\n'));
  process.exit(1);
}

if (!/^sbp_[A-Za-z0-9]{20,}$/.test(token)) {
  console.error(
    red('\n  That does not look like a Supabase access token.\n') +
      dim(`  They start with "sbp_" and are long. You pasted ${token.length} characters`) +
      dim(` starting "${token.slice(0, 4)}".\n\n`) +
      dim('  Make sure you copied the token itself, not the URL of the page.\n'),
  );
  process.exit(1);
}

// --- Hand it to the CLI -----------------------------------------------------
process.stdout.write('  Connecting… ');

try {
  await supabase(['login', '--token', token]);
} catch (e) {
  console.error(red('failed.\n'));
  console.error(dim(`  ${(e.stderr || e.message || '').trim().split('\n').slice(-3).join('\n  ')}\n`));
  console.error(`  ${yellow('Most likely:')} the token was revoked or only partly copied. Generate a fresh one.\n`);
  process.exit(1);
}

// --- Prove it ---------------------------------------------------------------
try {
  const { stdout } = await supabase(['projects', 'list']);
  console.log(green('connected.\n'));

  const rows = stdout.split('\n').filter((l) => l.includes('│') && !l.includes('ID')).length;
  console.log(
    rows > 0
      ? dim(`  Found ${rows} existing project(s) in your account.`)
      : dim('  No projects yet — one will be created for you.'),
  );
  console.log(green(bold('\n  Done. Tell Claude and it will take it from here.\n')));
} catch (e) {
  console.error(red('\n  Logged in, but listing projects failed:\n'));
  console.error(dim(`  ${(e.stderr || e.message || '').trim()}\n`));
  process.exit(1);
}
