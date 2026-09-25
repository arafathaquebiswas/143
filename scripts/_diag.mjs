import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.mjs';

const env = await loadEnv();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

const txt = await readFile('/Users/arafat/Desktop/143/ACCOUNTS.local.txt', 'utf8');
const email = txt.match(/email:\s*(\S+)/)[1];
const password = txt.match(/password:\s*(\S+)/)[1];

const c = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
const { data: sess, error: se } = await c.auth.signInWithPassword({ email, password });
console.log('signed in:', !!sess.user, se?.message ?? '');

// upload one photo to test with
const id = crypto.randomUUID();
const full = `photos/${sess.user.id}/${id}.jpg`;
const thumb = `thumbs/${sess.user.id}/${id}.jpg`;
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
await c.storage.from('memories').upload(full, JPEG, { contentType: 'image/jpeg' });
await c.storage.from('memories').upload(thumb, JPEG, { contentType: 'image/jpeg' });
const { data: ins, error: ie } = await c.from('photos').insert({
  uploader_id: sess.user.id, storage_path: full, thumb_path: thumb,
  caption: 'diag', memory_date: '2026-05-05',
}).select();
console.log('inserted:', ins?.length, ie?.message ?? '');

console.log('\n--- A. plain select ---');
const r1 = await c.from('photos').select('*');
console.log('  rows:', r1.data?.length, '| error:', r1.error?.message ?? 'none');

console.log('\n--- B. THE APP QUERY: select with uploader embed ---');
const r2 = await c.from('photos').select('*, uploader:allowed_users(display_name)');
console.log('  rows:', r2.data?.length, '| error:', r2.error?.message ?? 'none');
console.log('  code:', r2.error?.code ?? '-', '| hint:', r2.error?.hint ?? '-');
console.log('  details:', r2.error?.details ?? '-');
if (r2.data?.[0]) console.log('  first row uploader:', JSON.stringify(r2.data[0].uploader));

console.log('\n--- C. embed via explicit FK name ---');
const r3 = await c.from('photos').select('*, allowed_users!photos_uploader_id_fkey(display_name)');
console.log('  rows:', r3.data?.length, '| error:', r3.error?.message ?? 'none');

console.log('\n--- D. signed url with various TTLs ---');
for (const ttl of [1, 5, 60]) {
  const { data: s, error } = await c.storage.from('memories').createSignedUrl(full, ttl);
  if (error) { console.log(`  ttl=${ttl}s -> sign error: ${error.message}`); continue; }
  const res = await fetch(s.signedUrl);
  console.log(`  ttl=${ttl}s -> HTTP ${res.status}`);
}

// cleanup
await admin.from('photos').delete().eq('id', ins[0].id);
await admin.storage.from('memories').remove([full, thumb]);
console.log('\ncleaned up');
