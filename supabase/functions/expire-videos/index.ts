// ===========================================================================
//  expire-videos — deletes video memories older than 30 days
//
//  Runs inside Supabase. The service-role key is injected by the platform,
//  so it never reaches Hostinger, the browser, or any file in this repo.
//
//  Safety, in layers:
//   1. The query matches media_kind = 'video' AND expires_at < now() only.
//   2. A database CHECK constraint forbids a photo from having expires_at at
//      all, so a photo cannot satisfy that query even in principle.
//   3. Every candidate is re-checked in code before anything is removed.
//   4. The storage delete is awaited and its result inspected. A row is only
//      deleted once BOTH its files are confirmed gone, so a failure leaves the
//      record intact and the next run retries instead of orphaning the file.
// ===========================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  // Only the scheduler may call this.
  const expected = Deno.env.get('CLEANUP_SECRET');
  if (!expected || req.headers.get('x-cleanup-secret') !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  const { data: expired, error } = await supabase
    .from('photos')
    .select('id, storage_path, thumb_path, media_kind, expires_at, caption')
    .eq('media_kind', 'video')
    .not('expires_at', 'is', null)
    .lt('expires_at', new Date().toISOString())
    .limit(200);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const report = {
    dryRun,
    examined: expired?.length ?? 0,
    deleted: [] as string[],
    keptForRetry: [] as { id: string; reason: string }[],
    refused: [] as { id: string; reason: string }[],
  };

  for (const row of expired ?? []) {
    // Belt and braces: never touch anything that is not an expired video.
    if (row.media_kind !== 'video') {
      report.refused.push({ id: row.id, reason: 'not a video' });
      continue;
    }
    if (!row.expires_at || new Date(row.expires_at) >= new Date()) {
      report.refused.push({ id: row.id, reason: 'not expired' });
      continue;
    }
    if (dryRun) {
      report.deleted.push(row.id);
      continue;
    }

    // Remove the video and its poster, and confirm both are really gone.
    const paths = [row.storage_path, row.thumb_path].filter(Boolean);
    const { data: removed, error: storageError } = await supabase.storage
      .from('memories')
      .remove(paths);

    if (storageError) {
      report.keptForRetry.push({ id: row.id, reason: storageError.message });
      continue;
    }

    const stillThere: string[] = [];
    for (const path of paths) {
      const dir = path.split('/').slice(0, -1).join('/');
      const name = path.split('/').pop()!;
      const { data: found } = await supabase.storage.from('memories').list(dir, { search: name });
      if ((found ?? []).some((f) => f.name === name)) stillThere.push(path);
    }

    if (stillThere.length > 0) {
      report.keptForRetry.push({ id: row.id, reason: `still present: ${stillThere.join(', ')}` });
      continue;
    }

    // Files confirmed gone — now the row. Comments and favourites cascade
    // via the foreign keys already in the schema, so nothing is orphaned.
    const { error: rowError } = await supabase
      .from('photos')
      .delete()
      .eq('id', row.id)
      .eq('media_kind', 'video');

    if (rowError) {
      report.keptForRetry.push({ id: row.id, reason: `row: ${rowError.message}` });
      continue;
    }

    report.deleted.push(row.id);
    void removed;
  }

  // -------------------------------------------------------------------------
  //  Second job, same daily run: drop notifications past their 21 days.
  //
  //  Deliberately last, and deliberately isolated. It runs after the video
  //  work so it cannot affect it, and its own failure is reported rather than
  //  thrown, so a problem here can never stop videos being cleaned up.
  //
  //  purge_expired_notifications() contains a single delete statement whose
  //  table is public.notifications. It cannot reach a photo, a video, a
  //  storage file, a comment, a favourite or a Recreate Someday item.
  // -------------------------------------------------------------------------
  let notifications: { purged: number } | { error: string };
  if (dryRun) {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .lt('expires_at', new Date().toISOString());
    notifications = error ? { error: error.message } : { purged: count ?? 0 };
  } else {
    const { data, error } = await supabase.rpc('purge_expired_notifications');
    notifications = error ? { error: error.message } : { purged: data ?? 0 };
  }

  return new Response(JSON.stringify({ ...report, notifications }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
