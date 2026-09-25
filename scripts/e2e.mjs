#!/usr/bin/env node
/**
 * End-to-end verification against the live Supabase project, as the real
 * signed-in users. Creates test data, exercises every feature, then removes
 * everything it made.
 *
 *   npm run e2e
 */

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { bold, dim, green, loadEnv, red } from './env.mjs';

const env = await loadEnv();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
const anon = () => createClient(env.url, env.anonKey, { auth: { persistSession: false } });

const results = [];
const pass = (n, d = '') => { results.push([true, n, d]); console.log(`  ${green('PASS')}  ${n}${d ? dim('  ' + d) : ''}`); };
const fail = (n, d = '') => { results.push([false, n, d]); console.log(`  ${red('FAIL')}  ${n}${d ? dim('  ' + d) : ''}`); };
const check = (cond, n, d = '') => (cond ? pass(n, d) : fail(n, d));

// --- credentials, read from the local file, never printed -------------------
const creds = {};
for (const block of (await readFile('ACCOUNTS.local.txt', 'utf8')).split('\n\n')) {
  const email = block.match(/email:\s*(\S+)/)?.[1];
  const password = block.match(/password:\s*(\S+)/)?.[1];
  const name = block.trim().split('\n')[0]?.trim();
  if (email && password) creds[email] = { password, name };
}

const [emailA, emailB] = Object.keys(creds);

// The album is no longer empty in real use, so the suite must leave the real
// data exactly as it found it.
const { data: settingsBefore } = await admin.from('app_settings').select('key, value');
const { count: photosBefore } = await admin
  .from('photos')
  .select('id', { count: 'exact', head: true });

async function signIn(email) {
  const client = anon();
  const { data, error } = await client.auth.signInWithPassword({ email, password: creds[email].password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { client, user: data.user };
}

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

// ---------------------------------------------------------------------------
// Before anything else: clear rows left behind by a previous run that crashed
// part-way. This suite runs against the real album, so it must never
// accumulate fixtures. Matching is deliberately narrow — a caption AND a
// filename this suite is known to use — so real photos can never be caught.
// ---------------------------------------------------------------------------
const FIXTURE_CAPTIONS = [
  'Test memory 1', 'Test memory 2', 'Test memory 3',
  'Edited by the other person', 'Live deployment test',
];
const FIXTURE_FILENAMES = ['test1.jpg', 'test2.jpg', 'test3.jpg'];

async function sweepLeftovers(label) {
  const { data: stale } = await admin
    .from('photos')
    .select('id, storage_path, thumb_path')
    .in('caption', FIXTURE_CAPTIONS)
    .in('original_name', FIXTURE_FILENAMES);

  if (!stale || stale.length === 0) return 0;

  await admin.storage.from('memories').remove(stale.flatMap((r) => [r.storage_path, r.thumb_path]));
  await admin.from('photos').delete().in('id', stale.map((r) => r.id));
  console.log(dim(`  swept ${stale.length} leftover fixture photo(s) ${label}`));
  return stale.length;
}

await sweepLeftovers('from a previous run');

console.log(bold('\n1. AUTHENTICATION\n'));

let A, B;
try { A = await signIn(emailA); pass(`${creds[emailA].name} can sign in`, emailA); }
catch (e) { fail(`${creds[emailA].name} can sign in`, e.message); process.exit(1); }
try { B = await signIn(emailB); pass(`${creds[emailB].name} can sign in`, emailB); }
catch (e) { fail(`${creds[emailB].name} can sign in`, e.message); process.exit(1); }

{
  const { error } = await anon().auth.signInWithPassword({ email: emailA, password: 'definitely-wrong-password' });
  check(!!error, 'wrong password is refused', error?.message);
}

console.log(bold('\n2. NON-ALLOW-LISTED USER (authenticated but not an owner)\n'));
{
  const email = `intruder-${Date.now()}@mailinator.com`;
  const password = 'Intruder-Test-12345';
  const { data: made } = await admin.auth.admin.createUser({ email, password, email_confirm: true });

  const intruder = anon();
  const { error: signInError } = await intruder.auth.signInWithPassword({ email, password });
  check(!signInError, 'a non-owner CAN authenticate (expected)', 'the allow list is the real gate');

  const { data: photos } = await intruder.from('photos').select('*');
  check((photos ?? []).length === 0, 'non-owner reads 0 photos');
  const { data: people } = await intruder.from('allowed_users').select('*');
  check((people ?? []).length === 0, 'non-owner reads 0 rows from the allow list');
  const { data: settings } = await intruder.from('app_settings').select('*');
  check((settings ?? []).length === 0, 'non-owner reads 0 settings');
  const { error: upErr } = await intruder.storage.from('memories').upload(`photos/x/${Date.now()}.jpg`, TINY_JPEG, { contentType: 'image/jpeg' });
  check(!!upErr, 'non-owner cannot upload', upErr?.message);
  const { error: insErr } = await intruder.from('photos').insert({
    uploader_id: made.user.id, storage_path: `p/${Date.now()}.jpg`, thumb_path: `t/${Date.now()}.jpg`, memory_date: '2026-01-01',
  });
  check(!!insErr, 'non-owner cannot insert a photo row', insErr?.code);

  await admin.auth.admin.deleteUser(made.user.id);
  pass('test intruder account removed');
}

console.log(bold('\n3. UPLOAD (single and multiple)\n'));
const uploaded = [];
{
  for (const n of [1, 2, 3]) {
    const id = crypto.randomUUID();
    const full = `photos/${A.user.id}/${id}.jpg`;
    const thumb = `thumbs/${A.user.id}/${id}.jpg`;
    const { error: e1 } = await A.client.storage.from('memories').upload(full, TINY_JPEG, { contentType: 'image/jpeg' });
    const { error: e2 } = await A.client.storage.from('memories').upload(thumb, TINY_JPEG, { contentType: 'image/jpeg' });
    if (e1 || e2) { fail(`upload photo ${n}`, (e1 || e2).message); continue; }
    uploaded.push({ full, thumb, id });
  }
  check(uploaded.length === 3, 'multiple photos uploaded to private storage', `${uploaded.length}/3`);

  const rows = uploaded.map((u, i) => ({
    uploader_id: A.user.id, storage_path: u.full, thumb_path: u.thumb,
    caption: `Test memory ${i + 1}`, memory_date: `2026-0${i + 1}-15`,
    is_special: false, size_bytes: TINY_JPEG.length, original_name: `test${i + 1}.jpg`,
  }));
  const { data: inserted, error } = await A.client.from('photos').insert(rows).select();
  check(!error && inserted?.length === 3, 'photo metadata rows created', error?.message ?? `${inserted?.length} rows`);
  uploaded.forEach((u, i) => { u.rowId = inserted?.[i]?.id; });
}

console.log(bold('\n4. VIEWING AND SIGNED URLS\n'));
{
  const { data: photos, error: listError } = await A.client.from('photos').select('*, uploader:allowed_users!photos_uploader_id_fkey(display_name)').order('memory_date', { ascending: false });
  check(!listError, 'the gallery query runs without error', listError?.code ?? listError?.message);
  const testIds = new Set(uploaded.map((u) => u.rowId));
  const seenTest = (photos ?? []).filter((p) => testIds.has(p.id));
  check(seenTest.length === 3, 'owner A sees all 3 test photos', `${seenTest.length}/3 among ${photos?.length ?? 0} total`);
  check(seenTest[0]?.uploader?.display_name === creds[emailA].name, 'uploader name resolves', seenTest[0]?.uploader?.display_name);

  const { data: signed } = await A.client.storage.from('memories').createSignedUrls(uploaded.map((u) => u.full), 7200);
  const url = signed?.[0]?.signedUrl;
  check(!!url, 'signed URLs generated');
  const res = await fetch(url);
  check(res.ok, 'signed URL actually serves the image', `HTTP ${res.status}`);

  const bare = `${env.url}/storage/v1/object/public/memories/${uploaded[0].full}`;
  const bareRes = await fetch(bare);
  check(!bareRes.ok, 'same photo WITHOUT a signature is refused', `HTTP ${bareRes.status}`);

  const stripped = url.split('?')[0];
  const strippedRes = await fetch(stripped);
  check(!strippedRes.ok, 'signed URL with the token removed is refused', `HTTP ${strippedRes.status}`);
}

console.log(bold('\n5. SIGNED URL EXPIRY\n'));
{
  const { data: shortLived } = await A.client.storage.from('memories').createSignedUrl(uploaded[0].full, 5);
  const before = await fetch(shortLived.signedUrl);
  check(before.ok, 'freshly signed URL works', `HTTP ${before.status}`);
  await new Promise((r) => setTimeout(r, 7000));
  const after = await fetch(shortLived.signedUrl);
  check(!after.ok, 'the SAME URL stops working after it expires', `HTTP ${after.status}`);
}

console.log(bold('\n6. EDIT, FAVORITE, SPECIAL — as owner B on owner A\'s photo\n'));
{
  const target = uploaded[0].rowId;
  const { data: seen } = await B.client.from('photos').select('id').eq('id', target);
  check((seen ?? []).length === 1, 'owner B can see owner A\'s photo');

  const { error: editErr } = await B.client.from('photos').update({ caption: 'Edited by the other person', memory_date: '2026-06-01' }).eq('id', target);
  check(!editErr, 'owner B can edit owner A\'s caption and date', editErr?.message);

  const { data: after } = await B.client.from('photos').select('caption, memory_date, updated_at').eq('id', target).single();
  check(after?.caption === 'Edited by the other person' && after?.memory_date === '2026-06-01', 'the edit persisted', `${after?.caption} / ${after?.memory_date}`);

  const { error: specialErr } = await B.client.from('photos').update({ is_special: true }).eq('id', target);
  check(!specialErr, 'owner B can mark a photo special', specialErr?.message);

  const { error: favErr } = await B.client.from('favorites').upsert({ photo_id: target, user_id: B.user.id });
  check(!favErr, 'owner B can favorite', favErr?.message);
  const { error: favErr2 } = await A.client.from('favorites').upsert({ photo_id: target, user_id: A.user.id });
  check(!favErr2, 'owner A can favorite the same photo separately', favErr2?.message);

  const { data: hearts } = await A.client.from('favorites').select('user_id').eq('photo_id', target);
  check((hearts ?? []).length === 2, 'both hearts are stored independently', `${hearts?.length} hearts`);

  const { error: unfavErr } = await A.client.from('favorites').delete().eq('photo_id', target).eq('user_id', A.user.id);
  check(!unfavErr, 'owner A can remove only their own heart');
  const { data: left } = await B.client.from('favorites').select('user_id').eq('photo_id', target);
  check((left ?? []).length === 1 && left[0].user_id === B.user.id, 'owner B\'s heart survived');

  const { error: stealErr } = await A.client.from('favorites').delete().eq('photo_id', target).eq('user_id', B.user.id);
  const { data: stillThere } = await B.client.from('favorites').select('user_id').eq('photo_id', target);
  check((stillThere ?? []).length === 1, 'owner A CANNOT remove owner B\'s heart', stealErr?.message ?? 'row untouched');
}

console.log(bold('\n6b. COMMENTS\n'));
{
  const target = uploaded[0].rowId;

  const { data: mine, error: e1 } = await A.client
    .from('comments').insert({ photo_id: target, author_id: A.user.id, body: 'A note from owner A' })
    .select('id, body').single();
  check(!e1, 'owner A can post a comment', e1?.message);

  if (e1 || !mine) {
    fail('comments table is reachable', 'run supabase/add-comments.sql in the SQL Editor');
    console.log(red('       skipping the rest of the comment checks\n'));
  } else {

  const { data: theirs, error: e2 } = await B.client
    .from('comments').insert({ photo_id: target, author_id: B.user.id, body: 'A reply from owner B' })
    .select('id, body').single();
  check(!e2, 'owner B can post a comment', e2?.message);

  const { data: seenByA } = await A.client.from('comments').select('id, body').eq('photo_id', target).order('created_at');
  check((seenByA ?? []).length === 2, 'both comments are visible to both of them', `${seenByA?.length} visible`);

  const { error: editErr } = await A.client.from('comments').update({ body: 'edited by A' }).eq('id', mine.id);
  check(!editErr, 'owner A can edit their own comment', editErr?.message);

  const { data: hijack } = await A.client
    .from('comments').update({ body: 'A tampering with B' }).eq('id', theirs.id).select('id');
  const { data: bStill } = await B.client.from('comments').select('body').eq('id', theirs.id).single();
  check((hijack ?? []).length === 0 && bStill?.body === 'A reply from owner B',
    'owner A CANNOT edit owner B\'s comment', 'row untouched');

  const { data: steal } = await A.client.from('comments').delete().eq('id', theirs.id).select('id');
  const { data: bAlive } = await B.client.from('comments').select('id').eq('id', theirs.id);
  check((steal ?? []).length === 0 && (bAlive ?? []).length === 1,
    'owner A CANNOT delete owner B\'s comment', 'row untouched');

  const { data: ownDel } = await A.client.from('comments').delete().eq('id', mine.id).select('id');
  check((ownDel ?? []).length === 1, 'owner A can delete their own comment');

  const anonClient = anon();
  const { data: anonRead } = await anonClient.from('comments').select('id').limit(1);
  check((anonRead ?? []).length === 0, 'a signed-out visitor reads 0 comments');
  const { error: anonWrite } = await anonClient
    .from('comments').insert({ photo_id: target, author_id: A.user.id, body: 'intruder' });
  check(!!anonWrite, 'a signed-out visitor cannot post', anonWrite?.code);

  const { error: emptyErr } = await A.client
    .from('comments').insert({ photo_id: target, author_id: A.user.id, body: '   ' });
  check(!!emptyErr, 'a blank comment is rejected by the database', emptyErr?.code);

    await admin.from('comments').delete().eq('photo_id', target);
  }
}

console.log(bold('\n7. DOWNLOAD\n'));
{
  const { data: dl } = await A.client.storage.from('memories').createSignedUrl(uploaded[0].full, 60, { download: 'memory.jpg' });
  const res = await fetch(dl.signedUrl);
  const disposition = res.headers.get('content-disposition') ?? '';
  check(res.ok, 'download link works', `HTTP ${res.status}`);
  check(disposition.includes('attachment'), 'download saves as a file rather than opening', disposition.slice(0, 40));
}

console.log(bold('\n8. DELETE — equal permissions\n'));
{
  const target = uploaded[2].rowId;
  const { error } = await B.client.from('photos').delete().eq('id', target);
  check(!error, 'owner B can delete a photo owner A uploaded', error?.message);
  const { data: gone } = await A.client.from('photos').select('id').eq('id', target);
  check((gone ?? []).length === 0, 'the photo is gone for both of them');

  const { error: rmErr } = await B.client.storage.from('memories').remove([uploaded[2].full, uploaded[2].thumb]);
  check(!rmErr, 'owner B can remove the files from storage', rmErr?.message);
}

console.log(bold('\n9. SETTINGS\n'));
{
  const { error } = await A.client.from('app_settings').upsert(
    [{ key: 'relationship_start_date', value: '2024-03-14' }], { onConflict: 'key' });
  check(!error, 'owner A can change the relationship start date', error?.message);
  const { data } = await B.client.from('app_settings').select('value').eq('key', 'relationship_start_date').single();
  check(data?.value === '2024-03-14', 'owner B sees the same setting', data?.value);

  const { error: nameErr } = await A.client.from('allowed_users').update({ display_name: creds[emailA].name }).eq('user_id', A.user.id);
  check(!nameErr, 'owner A can rename themselves');
  const { error: hijack } = await A.client.from('allowed_users').update({ display_name: 'Hijacked' }).eq('user_id', B.user.id);
  const { data: bName } = await B.client.from('allowed_users').select('display_name').eq('user_id', B.user.id).single();
  check(bName?.display_name !== 'Hijacked', 'owner A CANNOT rename owner B', hijack?.message ?? 'row untouched');
}

console.log(bold('\n10. SIGN OUT\n'));
{
  await A.client.auth.signOut();
  const { data: afterOut } = await A.client.from('photos').select('id');
  check((afterOut ?? []).length === 0, 'after sign-out the session reads nothing');
}

// --- clean up ---------------------------------------------------------------
console.log(bold('\nCLEANUP\n'));
{
  const paths = uploaded.flatMap((u) => [u.full, u.thumb]);
  await admin.storage.from('memories').remove(paths);
  const ids = uploaded.map((u) => u.rowId).filter(Boolean);
  if (ids.length) await admin.from('photos').delete().in('id', ids);
  await admin.from('app_settings').upsert(settingsBefore, { onConflict: 'key' });

  const { data: settingsAfter } = await admin.from('app_settings').select('key, value');
  const settingsIntact = (settingsBefore ?? []).every(
    (b) => (settingsAfter ?? []).find((a) => a.key === b.key)?.value === b.value,
  );
  check(settingsIntact, 'your real settings were restored untouched',
    settingsAfter?.find((r) => r.key === 'relationship_start_date')?.value);

  await sweepLeftovers('after the run');

  const { count } = await admin.from('photos').select('id', { count: 'exact', head: true });
  check(count === photosBefore, 'photo count back to where it started', `${count} photos (started with ${photosBefore})`);

  // A matching total is not enough — assert no fixture row survives at all.
  const { data: survivors } = await admin
    .from('photos')
    .select('id')
    .in('caption', FIXTURE_CAPTIONS)
    .in('original_name', FIXTURE_FILENAMES);
  check((survivors ?? []).length === 0, 'no test photo left in your album', `${survivors?.length ?? 0} found`);

  const { data: staleComments } = await admin
    .from('comments')
    .select('id')
    .in('body', ['A note from owner A', 'A reply from owner B', 'edited by A', 'A tampering with B']);
  if ((staleComments ?? []).length) {
    await admin.from('comments').delete().in('id', staleComments.map((c) => c.id));
  }
  check((staleComments ?? []).length === 0, 'no test comment left in your album', `${staleComments?.length ?? 0} swept`);
}

const failed = results.filter(([ok]) => !ok);
console.log(bold(`\n${results.length - failed.length}/${results.length} checks passed`));
if (failed.length) {
  console.log(red(bold('\nFailures:')));
  for (const [, n, d] of failed) console.log(red(`  - ${n} ${dim(d)}`));
  process.exit(1);
}
console.log(green(bold('\nEverything passed.\n')));
