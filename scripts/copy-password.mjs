#!/usr/bin/env node
/**
 * Copies one account's password to the clipboard so it can be pasted rather
 * than typed. The password is never printed.
 *
 *   npm run copy-password -- arafathaquebiswas@gmail.com
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { bold, dim, green, red } from './env.mjs';

const run = promisify(execFile);
const wanted = (process.argv[2] ?? '').toLowerCase().trim();

let txt;
try {
  txt = await readFile('ACCOUNTS.local.txt', 'utf8');
} catch {
  console.error(red('\n  ACCOUNTS.local.txt not found. Run `npm run provision` first.\n'));
  process.exit(1);
}

const accounts = txt.split('\n\n').flatMap((block) => {
  const email = block.match(/email:\s*(\S+)/)?.[1];
  const password = block.match(/password:\s*(\S+)/)?.[1];
  const name = block.trim().split('\n')[0]?.trim();
  return email && password ? [{ email, password, name }] : [];
});

if (!wanted) {
  console.log(bold('\n  Which account?\n'));
  for (const a of accounts) console.log(`    npm run copy-password -- ${a.email}   ${dim(`(${a.name})`)}`);
  console.log();
  process.exit(0);
}

const hit = accounts.find((a) => a.email.toLowerCase() === wanted);
if (!hit) {
  console.error(red(`\n  No account for "${wanted}".`));
  console.error(dim(`  Known: ${accounts.map((a) => a.email).join(', ')}\n`));
  process.exit(1);
}

const clip = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'win32' ? 'clip' : 'xclip';
const child = run(clip, process.platform === 'linux' ? ['-selection', 'clipboard'] : []);
child.child.stdin.end(hit.password);
await child;

console.log(green(bold(`\n  ${hit.name}'s password is on your clipboard.\n`)));
console.log(`  Email:    ${hit.email}`);
console.log(dim(`  Password: ${hit.password.length} characters — press Cmd+V in the password field.\n`));
