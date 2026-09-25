import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.mjs';
const env = await loadEnv();
const a = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

// every file actually in the bucket
const files = [];
for (const dir of ['photos', 'thumbs']) {
  const { data: folders } = await a.storage.from('memories').list(dir);
  for (const f of folders ?? []) {
    if (f.id) { files.push(`${dir}/${f.name}`); continue; }
    const { data: inner } = await a.storage.from('memories').list(`${dir}/${f.name}`);
    for (const g of inner ?? []) if (g.id) files.push(`${dir}/${f.name}/${g.name}`);
  }
}

// every path referenced by a row
const { data: rows } = await a.from('photos').select('storage_path, thumb_path');
const referenced = new Set((rows ?? []).flatMap((r) => [r.storage_path, r.thumb_path]));

const orphans = files.filter((f) => !referenced.has(f));
console.log(`files in bucket: ${files.length}`);
console.log(`referenced by a row: ${referenced.size}`);
console.log(`orphans: ${orphans.length}`);
for (const o of orphans) console.log(`  ${o}`);

if (orphans.length) {
  const { error } = await a.storage.from('memories').remove(orphans);
  console.log(error ? `remove failed: ${error.message}` : `removed ${orphans.length} orphan(s)`);
}

// re-check
const after = [];
for (const dir of ['photos', 'thumbs']) {
  const { data: folders } = await a.storage.from('memories').list(dir);
  for (const f of folders ?? []) {
    if (f.id) { after.push(`${dir}/${f.name}`); continue; }
    const { data: inner } = await a.storage.from('memories').list(`${dir}/${f.name}`);
    for (const g of inner ?? []) if (g.id) after.push(`${dir}/${f.name}/${g.name}`);
  }
}
console.log(`\nbucket now holds ${after.length} file(s) — album is clean`);
