/** Shared helpers for the setup scripts. Loads .env.local, then layers
 *  .env.backup.local on top so the service role key lives in one place only. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadEnv(files = ['.env.local', '.env.backup.local']) {
  for (const file of files) {
    let text;
    try {
      text = await readFile(resolve(file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, '');
      if (value) process.env[match[1]] ??= value;
    }
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  };
}

/** Shows enough of a key to confirm which one it is, and no more. */
export function mask(key) {
  if (!key) return '(not set)';
  return `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} chars)`;
}

export const green = (s) => `\x1b[32m${s}\x1b[0m`;
export const red = (s) => `\x1b[31m${s}\x1b[0m`;
export const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
export const dim = (s) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s) => `\x1b[1m${s}\x1b[0m`;

export const PASS = green('  ok  ');
export const FAIL = red(' fail ');
export const SKIP = yellow(' skip ');

/** Reads a secret from the terminal without echoing it. */
export function promptHidden(question) {
  return new Promise((resolvePrompt) => {
    if (!process.stdin.isTTY) return resolvePrompt(null);

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let value = '';
    const onData = (char) => {
      // Enter, or Ctrl-C / Ctrl-D.
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        return resolvePrompt(value);
      }
      if (char === '\u0003' || char === '\u0004') {
        process.stdout.write('\n');
        process.exit(130);
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    process.stdin.on('data', onData);
  });
}

/** A strong password made from the platform's own randomness. */
export function generatePassword(length = 20) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}
