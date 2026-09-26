#!/usr/bin/env node
/** Copies one of the two cleanup values to your clipboard. Nothing is printed. */
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const what = process.argv[2];
const files = { secret: '.cleanup-secret.local', cron: '.cron-command.local' };
if (!files[what]) {
  console.log('\n  npm run cleanup:secret    copy the CLEANUP_SECRET (for Supabase)');
  console.log('  npm run cleanup:cron      copy the cron command (for hPanel)\n');
  process.exit(0);
}
const raw = (await readFile(files[what], 'utf8')).trim();
const value = what === 'secret' ? raw.split('=').slice(1).join('=') : raw;
const p = execFile('pbcopy');
p.stdin.end(value);
console.log(`\n  ${what === 'secret' ? 'CLEANUP_SECRET' : 'Cron command'} copied to clipboard (${value.length} chars). Not shown here on purpose.\n`);
