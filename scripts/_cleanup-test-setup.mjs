import { createClient } from '@supabase/supabase-js';
import { writeFile, chmod, readFile } from 'node:fs/promises';
import { loadEnv } from './env.mjs';

const env = await loadEnv();
const a = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

// ---- 1. shared secret, written locally, never printed ---------------------
let secret;
try {
  secret = (await readFile('.cleanup-secret.local', 'utf8')).trim().split('=').pop().trim();
  console.log('  secret: reusing existing .cleanup-secret.local');
} catch {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  secret = [...bytes].map((b) => b.toString(36)).join('').slice(0, 48);
  await writeFile('.cleanup-secret.local', `CLEANUP_SECRET=${secret}\n`);
  await chmod('.cleanup-secret.local', 0o600);
  console.log('  secret: generated -> .cleanup-secret.local (chmod 600, git-ignored)');
}

// ---- 2. snapshot the real album so we can prove it is untouched -----------
const { data: before } = await a.from('photos').select('id, storage_path, thumb_path, media_kind').order('created_at');
await writeFile('.photo-snapshot.local', JSON.stringify(before, null, 2));
console.log(`  snapshot: ${before.length} rows saved to .photo-snapshot.local`);
console.log(`            photos=${before.filter(r=>r.media_kind==='photo').length} videos=${before.filter(r=>r.media_kind==='video').length}`);

// ---- 3. throwaway test video + poster into PRIVATE storage ----------------
const { data: owner } = await a.from('allowed_users').select('user_id').limit(1).single();
const id = crypto.randomUUID();
const videoPath = `photos/${owner.user_id}/CLEANUPTEST-${id}.mp4`;
const posterPath = `thumbs/${owner.user_id}/CLEANUPTEST-${id}.jpg`;

// A structurally-valid MP4 header. This test is about deletion, not playback.
const mp4 = Buffer.concat([
  Buffer.from([0,0,0,0x20]), Buffer.from('ftypisom'),
  Buffer.from([0,0,2,0]), Buffer.from('isomiso2avc1mp41'),
  Buffer.alloc(512, 0),
]);
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');

const up1 = await a.storage.from('memories').upload(videoPath, mp4, { contentType: 'video/mp4' });
const up2 = await a.storage.from('memories').upload(posterPath, jpeg, { contentType: 'image/jpeg' });
console.log('  video uploaded :', up1.error ? 'FAIL ' + up1.error.message : videoPath.split('/').pop());
console.log('  poster uploaded:', up2.error ? 'FAIL ' + up2.error.message : posterPath.split('/').pop());
if (up1.error || up2.error) process.exit(1);

// ---- 4. an ALREADY-EXPIRED video row -------------------------------------
const { data: row, error } = await a.from('photos').insert({
  uploader_id: owner.user_id,
  storage_path: videoPath,
  thumb_path: posterPath,
  caption: 'CLEANUP TEST VIDEO — safe to delete',
  memory_date: new Date().toISOString().slice(0, 10),
  media_kind: 'video',
  expires_at: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days ago
  duration_seconds: 3,
  size_bytes: mp4.length,
  width: 640, height: 360,
  original_name: 'cleanup-test.mp4',
}).select('id, media_kind, expires_at').single();

console.log('  expired row    :', error ? 'FAIL ' + error.message : row.id + '  expires_at=' + row.expires_at.slice(0,19) + ' (past)');
if (error) process.exit(1);

// ---- 5. also prove a photo cannot be made to look expired ----------------
const photo = before.find((r) => r.media_kind === 'photo');
const bad = await a.from('photos').update({ expires_at: new Date(Date.now() - 86400000).toISOString() }).eq('id', photo.id);
console.log('  photo given expiry?', bad.error ? 'BLOCKED (' + bad.error.code + ') — photos cannot be selected for deletion' : '!! ALLOWED — unsafe');

const { count } = await a.from('photos').select('id',{count:'exact',head:true});
console.log(`\n  album now: ${count} rows (${before.length} real + 1 test video)`);
