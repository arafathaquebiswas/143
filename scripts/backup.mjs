#!/usr/bin/env node
/**
 * Downloads a complete copy of the album to your own computer.
 *
 *   node scripts/backup.mjs [destination-folder]
 *
 * Produces:
 *   backups/2026-09-25/
 *     photos/...              every original file, in its storage folders
 *     photos.json             the photos table
 *     favorites.json          the favorites table
 *     allowed_users.json      who has access
 *     app_settings.json       your settings
 *     manifest.json           counts, sizes and anything that failed
 *
 * Needs two environment variables. Put them in .env.backup.local (git-ignored)
 * or pass them inline:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/backup.mjs
 *
 * The service role key bypasses Row Level Security, which is what lets this
 * script read every file. Never put it in .env.local, never deploy it to
 * Vercel, and never commit it.
 */

import { createClient } from '@supabase/supabase-js';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BUCKET = 'memories';
const TABLES = ['allowed_users', 'photos', 'favorites', 'app_settings'];

await loadEnvFile('.env.backup.local');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    '\nMissing credentials.\n' +
      '  NEXT_PUBLIC_SUPABASE_URL    — Supabase → Project Settings → API → Project URL\n' +
      '  SUPABASE_SERVICE_ROLE_KEY   — same page, the "service_role" secret key\n\n' +
      'Put both in .env.backup.local and run this again.\n',
  );
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const stamp = new Date().toISOString().slice(0, 10);
const outDir = resolve(process.argv[2] ?? join('backups', stamp));
await mkdir(outDir, { recursive: true });

console.log(`Backing up to ${outDir}\n`);

// --- 1. Tables -------------------------------------------------------------
const tableCounts = {};
for (const table of TABLES) {
  const rows = await fetchAll(table);
  await writeFile(join(outDir, `${table}.json`), JSON.stringify(rows, null, 2));
  tableCounts[table] = rows.length;
  console.log(`  ${table.padEnd(16)} ${rows.length} rows`);
}

// --- 2. Files --------------------------------------------------------------
console.log('\nListing files…');
const files = await listAllFiles('');
console.log(`  ${files.length} files found\n`);

let downloaded = 0;
let bytes = 0;
const failures = [];

for (const [index, path] of files.entries()) {
  const target = join(outDir, 'photos', path);
  await mkdir(dirname(target), { recursive: true });

  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) throw error;

    const buffer = Buffer.from(await data.arrayBuffer());
    await pipeline(Readable.from(buffer), createWriteStream(target));

    downloaded += 1;
    bytes += buffer.length;
  } catch (e) {
    failures.push({ path, error: e?.message ?? String(e) });
  }

  if ((index + 1) % 25 === 0 || index + 1 === files.length) {
    process.stdout.write(`\r  downloaded ${index + 1}/${files.length}`);
  }
}
process.stdout.write('\n');

// --- 3. Manifest -----------------------------------------------------------
const manifest = {
  created_at: new Date().toISOString(),
  project_url: url,
  tables: tableCounts,
  files: { found: files.length, downloaded, failed: failures.length },
  total_bytes: bytes,
  total_readable: `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
  failures,
};
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\nDone. ${downloaded} files, ${manifest.total_readable}.`);
if (failures.length > 0) {
  console.log(`${failures.length} file(s) failed — see manifest.json.`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------

/** Reads a whole table in pages, so large albums do not hit the row cap. */
async function fetchAll(table) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

/** Walks every folder in the bucket and returns full object paths. */
async function listAllFiles(prefix) {
  const found = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) throw new Error(`Listing "${prefix || '/'}": ${error.message}`);

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Storage marks real files with metadata; anything else is a folder.
      if (entry.id && entry.metadata) found.push(path);
      else found.push(...(await listAllFiles(path)));
    }

    if (data.length < pageSize) return found;
  }
}

/** A tiny .env reader so the script needs no extra dependency. */
async function loadEnvFile(file) {
  let text;
  try {
    text = await readFile(resolve(file), 'utf8');
  } catch {
    return;
  }

  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}
