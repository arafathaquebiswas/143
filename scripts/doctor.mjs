#!/usr/bin/env node
/**
 * Checks that Supabase is set up correctly, in the order the README does it.
 *
 *   npm run doctor
 *
 * Every check prints ok / fail / skip, and the first failure tells you exactly
 * what to go and do. Run it after each setup step.
 *
 * Works with just the two NEXT_PUBLIC_* variables. If SUPABASE_SERVICE_ROLE_KEY
 * is also present (in .env.backup.local), it runs a few extra checks that RLS
 * would otherwise hide.
 */

import { createClient } from '@supabase/supabase-js';
import { bold, dim, FAIL, loadEnv, mask, PASS, red, SKIP, green, yellow } from './env.mjs';

const TABLES = ['allowed_users', 'photos', 'favorites', 'app_settings'];
const BUCKET = 'memories';

const env = await loadEnv();
const problems = [];
let checks = 0;

function report(state, label, detail = '') {
  checks += 1;
  console.log(`[${state}] ${label}${detail ? dim(`  ${detail}`) : ''}`);
}

function fail(label, detail, fix) {
  report(FAIL, label, detail);
  problems.push(fix);
}

console.log(bold('\nOur Little World — setup check\n'));

// --- Step 5: environment ---------------------------------------------------
console.log(bold('Environment'));

if (!env.url) {
  fail(
    'NEXT_PUBLIC_SUPABASE_URL',
    'missing',
    'Create .env.local (cp .env.local.example .env.local) and paste your Project URL from Supabase → Project Settings → API.',
  );
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.url)) {
  fail(
    'NEXT_PUBLIC_SUPABASE_URL',
    env.url,
    'That does not look like a project URL. It should be https://<something>.supabase.co with nothing after it.',
  );
} else {
  report(PASS, 'NEXT_PUBLIC_SUPABASE_URL', env.url);
}

if (!env.anonKey) {
  fail(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'missing',
    'Paste the anon / publishable key from Supabase → Project Settings → API into .env.local.',
  );
} else if (env.anonKey.length < 40) {
  fail('NEXT_PUBLIC_SUPABASE_ANON_KEY', mask(env.anonKey), 'That key looks too short — copy the whole thing.');
} else {
  report(PASS, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', mask(env.anonKey));
}

if (env.serviceKey) report(PASS, 'SUPABASE_SERVICE_ROLE_KEY', mask(env.serviceKey));
else report(SKIP, 'SUPABASE_SERVICE_ROLE_KEY', 'not set — some checks below will be skipped');

if (env.serviceKey && env.serviceKey === env.anonKey) {
  fail(
    'service role key',
    'identical to the anon key',
    'You copied the same key twice. The service_role key is the separate secret one on the same dashboard page.',
  );
}

if (!env.url || !env.anonKey) finish();

// --- Step 1: the project is reachable --------------------------------------
console.log(bold('\nConnection'));

const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
const admin = env.serviceKey
  ? createClient(env.url, env.serviceKey, { auth: { persistSession: false } })
  : null;

try {
  const res = await fetch(`${env.url.replace(/\/$/, '')}/auth/v1/health`, {
    headers: { apikey: env.anonKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) report(PASS, 'Supabase project is reachable');
  else fail('Supabase project is reachable', `HTTP ${res.status}`, 'Check the URL and key, and that the project is not paused (Supabase → Home).');
} catch (e) {
  fail(
    'Supabase project is reachable',
    e.name === 'TimeoutError' ? 'timed out' : e.message,
    'Check your internet connection and that the project URL is right. A free project pauses after a week idle — open the dashboard to wake it.',
  );
  finish();
}

// --- Step 2: schema --------------------------------------------------------
console.log(bold('\nDatabase (step 2)'));

const client = admin ?? anon;
let schemaMissing = false;

for (const table of TABLES) {
  const { error } = await client.from(table).select('*', { count: 'exact', head: true });

  // 42P01 = relation does not exist. Anything else means the table is there
  // and RLS simply had an opinion, which is fine.
  if (error && (error.code === '42P01' || /does not exist/i.test(error.message))) {
    schemaMissing = true;
    fail(`table ${table}`, 'does not exist', 'Run supabase/schema.sql in Supabase → SQL Editor → New query.');
  } else {
    report(PASS, `table ${table}`);
  }
}

if (schemaMissing) finish();

// --- Step 3: private storage -----------------------------------------------
console.log(bold('\nStorage (step 3)'));

if (admin) {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) {
    fail('bucket "memories"', error.message, 'Re-run supabase/schema.sql.');
  } else {
    const bucket = buckets.find((b) => b.id === BUCKET);
    if (!bucket) {
      fail('bucket "memories"', 'not found', 'Re-run supabase/schema.sql — it creates the bucket.');
    } else if (bucket.public) {
      fail(
        'bucket "memories" is private',
        'it is PUBLIC',
        'Anyone with a URL could read your photos. Re-run supabase/schema.sql, or set it to Private in Supabase → Storage.',
      );
    } else {
      report(PASS, 'bucket "memories" exists and is private');
    }
  }
} else {
  report(SKIP, 'bucket "memories"', 'needs SUPABASE_SERVICE_ROLE_KEY');
}

// --- Step 4: the two accounts ----------------------------------------------
console.log(bold('\nAccounts (step 4)'));

if (admin) {
  const { data: people, error } = await admin
    .from('allowed_users')
    .select('user_id, display_name')
    .order('created_at');

  if (error) {
    fail('allow list', error.message, 'Re-run supabase/schema.sql.');
  } else if (people.length === 0) {
    fail(
      'allow list has your two accounts',
      'it is empty',
      'Nobody can see anything yet. Add each person with:  npm run add-user -- you@example.com "Your Name"',
    );
  } else {
    report(PASS, `allow list has ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
      people.map((p) => p.display_name).join(', '));
    if (people.length === 1) {
      console.log(dim('       only one so far — add the second with: npm run add-user -- her@example.com "Her Name"'));
    }
  }

  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (!usersError) {
    const unconfirmed = users.users.filter((u) => !u.email_confirmed_at && !u.confirmed_at);
    if (unconfirmed.length > 0) {
      fail(
        'every account can sign in',
        `${unconfirmed.length} unconfirmed: ${unconfirmed.map((u) => u.email).join(', ')}`,
        'Turn off "Confirm email" in Supabase → Authentication → Sign In / Providers → Email, then re-create the user with Auto Confirm ticked.',
      );
    } else if (users.users.length > 0) {
      report(PASS, `${users.users.length} login ${users.users.length === 1 ? 'account' : 'accounts'} exist and are confirmed`);
    }

    const orphans = users.users.filter(
      (u) => !(people ?? []).some((p) => p.user_id === u.id),
    );
    if (orphans.length > 0) {
      console.log(dim(`       note: ${orphans.map((u) => u.email).join(', ')} can log in but sees nothing (not on the allow list)`));
    }
  }
} else {
  report(SKIP, 'allow list', 'needs SUPABASE_SERVICE_ROLE_KEY');
}

// --- The security check that matters ---------------------------------------
console.log(bold('\nPrivacy'));

const { data: leaked, error: rlsError } = await anon.from('photos').select('id, caption').limit(1);

if (rlsError || (leaked ?? []).length === 0) {
  report(PASS, 'a signed-out visitor cannot read any photo', 'RLS is doing its job');
} else {
  fail(
    'a signed-out visitor cannot read any photo',
    `${leaked.length} row(s) came back WITHOUT a login`,
    'Your album is exposed. Re-run supabase/schema.sql immediately and confirm RLS is enabled on every table.',
  );
}

const { data: anonSettings } = await anon.from('app_settings').select('key').limit(1);
if ((anonSettings ?? []).length === 0) {
  report(PASS, 'a signed-out visitor cannot read your settings');
} else {
  fail('a signed-out visitor cannot read your settings', 'settings are readable', 'Re-run supabase/schema.sql.');
}

finish();

// ---------------------------------------------------------------------------

function finish() {
  console.log();
  if (problems.length === 0) {
    console.log(green(bold(`All ${checks} checks passed.`)));
    console.log(dim('Next:  npm run dev   → http://localhost:3000\n'));
    process.exit(0);
  }

  console.log(red(bold(`${problems.length} of ${checks} checks need attention:\n`)));
  problems.forEach((fix, i) => console.log(`  ${yellow(`${i + 1}.`)} ${fix}\n`));
  process.exit(1);
}
