import 'server-only';

import { cache } from 'react';

import { BUCKET, PAGE_SIZE, SIGNED_URL_TTL } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings, MediaKind, Person, Photo, PhotoComment, PhotoFilter, PhotoRow } from '@/lib/types';

const DEFAULT_SETTINGS: AppSettings = {
  relationship_start_date: '2024-01-01',
  home_title: 'Our Little World',
  home_quote: 'Distance means so little when someone means so much.',
};

/**
 * The signed-in user, verified once per request.
 *
 * auth.getUser() revalidates the token with Supabase, measured at 214-260 ms
 * every time. getViewer() and getPhotos() each used to call it through their
 * own cache(), and React's cache only dedupes within a single function — so
 * every page paid two of those round trips back to back before a single photo
 * query could start. They now share this one.
 */
const authUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The logged-in person, plus the other half of the album. */
export const getViewer = cache(async function getViewer() {
  const supabase = await createClient();

  // The roster does not depend on who is asking — RLS scopes it either way —
  // so it can be fetched while the token is still being verified instead of
  // after. Two ~200 ms round trips that used to run back to back now overlap.
  const [user, { data: roster }] = await Promise.all([
    authUser(),
    supabase.from('allowed_users').select('user_id, display_name').order('created_at'),
  ]);
  if (!user) return null;

  const people = (roster ?? []) as Person[];
  const me = people.find((p) => p.user_id === user.id);

  // A valid login that is not on the allow list gets nothing.
  if (!me) return null;

  return {
    id: user.id,
    email: user.email ?? '',
    displayName: me.display_name,
    people,
    partner: people.find((p) => p.user_id !== user.id) ?? null,
  };
});

export const getSettings = cache(async function getSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('key, value');

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (row.key in settings && row.value) {
      settings[row.key as keyof AppSettings] = row.value;
    }
  }
  return settings;
});

/** Exactly the columns the UI uses — "*" also drags along anything added later. */
const PHOTO_COLUMNS =
  'id, uploader_id, storage_path, thumb_path, caption, memory_date, is_special, ' +
  'width, height, size_bytes, original_name, created_at, updated_at, ' +
  'collection, recreated_photo_id, recreated_at, ' +
  'media_kind, expires_at, duration_seconds, ' +
  'uploader:allowed_users!photos_uploader_id_fkey(display_name)';

/** Shares the single verified lookup above rather than repeating it. */
const currentUser = authUser;

/**
 * The two display names, once per request.
 *
 * getViewer() has already fetched the whole roster — the same two rows — so
 * re-querying allowed_users here was a second round trip for data already in
 * hand. It falls back to its own query only when there is no viewer.
 */
const nameMap = cache(async () => {
  const viewer = await getViewer();
  if (viewer) return new Map(viewer.people.map((p) => [p.user_id, p.display_name]));

  const supabase = await createClient();
  const { data } = await supabase.from('allowed_users').select('user_id, display_name');
  return new Map((data ?? []).map((p) => [p.user_id, p.display_name]));
});

type PhotoQueryRow = PhotoRow & { uploader: { display_name: string } | null };

/**
 * Loads photos and turns them into render-ready objects: signed image links,
 * uploader name and heart state, all resolved in a handful of round trips.
 */
export async function getPhotos(filter: PhotoFilter = {}): Promise<Photo[]> {
  const supabase = await createClient();
  // Kicked off now, awaited only where it is actually needed (marking which
  // hearts are yours, right at the end). Waiting for it here first cost a
  // serial ~235 ms before the photo query could even be sent; the two overlap
  // instead. RLS returns nothing to an unauthenticated request anyway, so
  // starting the query before the token is confirmed exposes nothing.
  const userPromise = currentUser();

  const {
    // Photo views must never pull video rows: it would change what the
    // gallery shows and start fetching video files it does not need.
    mediaKind = 'photo',
    collection = 'moment',
    pendingOnly,
    year,
    month,
    specialOnly = false,
    favoritesOnly = false,
    sort = 'memory',
    limit = PAGE_SIZE,
    offset = 0,
  } = filter;

  // Only the favourites-only view needs every row. Everywhere else we fetch
  // hearts scoped to the photos actually being returned, further down, so this
  // query does not grow with the size of the album.
  let favorites: { photo_id: string; user_id: string }[] = [];
  if (favoritesOnly) {
    const { data } = await supabase.from('favorites').select('photo_id, user_id');
    favorites = data ?? [];
  }

  // The foreign key is named explicitly: photos and allowed_users are related
  // twice (uploader_id, and again through favorites), so PostgREST needs to be
  // told which path to follow or it refuses the embed with PGRST201.
  let query = supabase
    .from('photos')
    .select(PHOTO_COLUMNS)
    .range(offset, offset + limit - 1);

  query =
    sort === 'created'
      ? query.order('created_at', { ascending: false })
      : query.order('memory_date', { ascending: false }).order('created_at', { ascending: false });

  query = query.eq('collection', collection).eq('media_kind', mediaKind);

  // Inspirations split into "still to do" and "already recreated".
  if (pendingOnly === true) query = query.is('recreated_at', null);
  if (pendingOnly === false) query = query.not('recreated_at', 'is', null);

  if (specialOnly) query = query.eq('is_special', true);

  if (year) {
    const from = month
      ? `${year}-${String(month).padStart(2, '0')}-01`
      : `${year}-01-01`;
    const to = month
      ? nextMonthStart(year, month)
      : `${year + 1}-01-01`;
    query = query.gte('memory_date', from).lt('memory_date', to);
  }

  if (favoritesOnly) {
    const ids = [...new Set(favorites.map((f) => f.photo_id))];
    if (ids.length === 0) return [];
    query = query.in('id', ids);
  }

  let { data, error } = await query;

  // Until supabase/add-collections.sql has been run the collection columns do
  // not exist yet. Rather than take the whole album down, fall back to the
  // pre-collections behaviour: everything is an Our Moment.
  if (error && isMissingCollectionColumn(error)) {
    if (collection === 'inspiration') return [];

    let retry = supabase
      .from('photos')
      .select(PHOTO_COLUMNS)
      .range(offset, offset + limit - 1);

    retry =
      sort === 'created'
        ? retry.order('created_at', { ascending: false })
        : retry.order('memory_date', { ascending: false }).order('created_at', { ascending: false });

    if (mediaKind !== 'photo') return [];
    if (specialOnly) retry = retry.eq('is_special', true);
    if (year) {
      const from = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
      const to = month ? nextMonthStart(year, month) : `${year + 1}-01-01`;
      retry = retry.gte('memory_date', from).lt('memory_date', to);
    }
    if (favoritesOnly) {
      const ids = [...new Set(favorites.map((f) => f.photo_id))];
      if (ids.length === 0) return [];
      retry = retry.in('id', ids);
    }

    ({ data, error } = await retry);
  }

  if (error) throw new Error(`Could not load photos: ${error.message}`);

  const rows = (data ?? []) as unknown as PhotoQueryRow[];
  if (rows.length === 0) return [];

  const pageIds = rows.map((r) => r.id);
  const partnerIds = rows.map((r) => r.recreated_photo_id).filter(Boolean) as string[];

  // Supabase sits a long way from the server, so every round trip costs real
  // time. These four are independent — run them together rather than one
  // after another.
  const [user, nameOf, favResult, commentResult, partnerResult] = await Promise.all([
    userPromise,
    nameMap(),
    favoritesOnly
      ? Promise.resolve({ data: favorites })
      : supabase.from('favorites').select('photo_id, user_id').in('photo_id', pageIds),
    supabase
      .from('comments')
      .select('id, photo_id, author_id, body, created_at')
      .in('photo_id', pageIds)
      .order('created_at'),
    partnerIds.length
      ? supabase
          .from('photos')
          .select('id, storage_path, thumb_path, caption, memory_date')
          .in('id', partnerIds)
      : Promise.resolve({ data: [] as { id: string; storage_path: string; thumb_path: string; caption: string | null; memory_date: string }[] }),
  ]);

  // Same guard as before, just reached after the queries rather than before.
  if (!user) return [];

  if (!favoritesOnly) favorites = favResult.data ?? [];
  const commentRows = commentResult.data;
  const partnerRows = partnerResult.data;

  // One batched signing call for every thumbnail and full-size image.
  const paths = rows.flatMap((r) => [r.thumb_path, r.storage_path]);
  for (const pr of partnerRows ?? []) paths.push(pr.thumb_path, pr.storage_path);
  const signed = await signPaths(paths);

  return rows.map((row) => {
    const hearts = favorites.filter((f) => f.photo_id === row.id);
    const { uploader, ...rest } = row;
    return {
      ...rest,
      uploaderName: uploader?.display_name ?? nameOf.get(row.uploader_id) ?? 'Someone',
      thumbUrl: signed.get(row.thumb_path) ?? '',
      url: signed.get(row.storage_path) ?? '',
      favoritedBy: hearts.map((h) => nameOf.get(h.user_id) ?? 'Someone'),
      isFavorite: hearts.some((h) => h.user_id === user.id),
      comments: (commentRows ?? [])
        .filter((c) => c.photo_id === row.id)
        .map<PhotoComment>((c) => ({
          id: c.id,
          photo_id: c.photo_id,
          author_id: c.author_id,
          authorName: nameOf.get(c.author_id) ?? 'Someone',
          body: c.body,
          created_at: c.created_at,
          isMine: c.author_id === user.id,
        })),
      recreated: (() => {
        if (!row.recreated_photo_id) return null;
        const pr = (partnerRows ?? []).find((x) => x.id === row.recreated_photo_id);
        if (!pr) return null;
        return {
          id: pr.id,
          url: signed.get(pr.storage_path) ?? '',
          thumbUrl: signed.get(pr.thumb_path) ?? '',
          caption: pr.caption,
          memory_date: pr.memory_date,
        };
      })(),
    } satisfies Photo;
  });
}

/** The Reels feed: videos only, newest first. */
export async function getReels(limit = 24, offset = 0): Promise<Photo[]> {
  return getPhotos({ mediaKind: 'video', sort: 'created', limit, offset });
}

/** How many reels exist, for the nav badge and the empty state. */
export async function getReelCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('media_kind', 'video');
  return error ? 0 : (count ?? 0);
}

/** Totals for the little stat row on the homepage. */
export async function getCounts() {
  const supabase = await createClient();

  const safe = async <T,>(p: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await p;
    return isMissingCollectionColumn(r.error) ? { count: null } : r;
  };

  const [photos, special, favorites, pending, recreated] = await Promise.all([
    safe(supabase.from('photos').select('id', { count: 'exact', head: true }).eq('collection', 'moment').eq('media_kind', 'photo')),
    safe(supabase.from('photos').select('id', { count: 'exact', head: true }).eq('collection', 'moment').eq('media_kind', 'photo').eq('is_special', true)),
    supabase.from('favorites').select('photo_id', { count: 'exact', head: true }),
    safe(supabase.from('photos').select('id', { count: 'exact', head: true }).eq('collection', 'inspiration').eq('media_kind', 'photo').is('recreated_at', null)),
    safe(supabase.from('photos').select('id', { count: 'exact', head: true }).eq('collection', 'inspiration').eq('media_kind', 'photo').not('recreated_at', 'is', null)),
  ]);

  // Before the migration the collection counts are unknown; fall back to the
  // plain totals so the homepage still reads correctly.
  const totals = photos.count === null
    ? await supabase.from('photos').select('id', { count: 'exact', head: true })
    : null;
  const totalSpecial = special.count === null
    ? await supabase.from('photos').select('id', { count: 'exact', head: true }).eq('is_special', true)
    : null;

  return {
    photos: photos.count ?? totals?.count ?? 0,
    special: special.count ?? totalSpecial?.count ?? 0,
    favorites: favorites.count ?? 0,
    pendingInspirations: pending.count ?? 0,
    recreatedInspirations: recreated.count ?? 0,
  };
}

/** Distinct years that actually have memories in them, newest first. */
export async function getYearsWithMemories(): Promise<number[]> {
  const supabase = await createClient();
  let { data, error } = await supabase
    .from('photos')
    .select('memory_date')
    .eq('collection', 'moment')
    .eq('media_kind', 'photo')
    .order('memory_date', { ascending: false });

  if (error && isMissingCollectionColumn(error)) {
    ({ data } = await supabase
      .from('photos')
      .select('memory_date')
      .order('memory_date', { ascending: false }));
  }

  const years = new Set<number>();
  for (const row of data ?? []) years.add(Number(row.memory_date.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

/**
 * Signed URLs, reused while they are still valid.
 *
 * Signing is the single most expensive thing these pages do — measured at
 * 663 ms for 36 paths, and the home page was paying it five times over. A
 * signature depends only on the path and the expiry, never on who is asking,
 * so the same URL can safely be handed to either owner. Both are authorised,
 * and the link is still private and still expires.
 *
 * Entries are dropped well before the URL itself expires, so a cached link
 * always has plenty of life left in it.
 */
const SIGN_CACHE = new Map<string, { url: string; expiresAt: number }>();

/** Reuse a signed URL only while at least this long remains on it. */
const SIGN_CACHE_SAFETY_MS = 15 * 60 * 1000;

function pruneSignCache(now: number) {
  if (SIGN_CACHE.size < 4000) return;
  for (const [path, entry] of SIGN_CACHE) {
    if (entry.expiresAt <= now) SIGN_CACHE.delete(path);
  }
}

/** Signs a batch of storage paths, returning path -> temporary URL. */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const now = Date.now();
  pruneSignCache(now);

  const missing: string[] = [];
  for (const path of unique) {
    const hit = SIGN_CACHE.get(path);
    if (hit && hit.expiresAt - now > SIGN_CACHE_SAFETY_MS) result.set(path, hit.url);
    else missing.push(path);
  }

  if (missing.length === 0) return result;

  const supabase = await createClient();
  const expiresAt = now + SIGNED_URL_TTL * 1000;

  // Sign in chunks so a very large album never sends one enormous request.
  const CHUNK = 200;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(slice, SIGNED_URL_TTL);
    for (const entry of data ?? []) {
      if (entry.signedUrl && entry.path) {
        result.set(entry.path, entry.signedUrl);
        SIGN_CACHE.set(entry.path, { url: entry.signedUrl, expiresAt });
      }
    }
  }
  return result;
}

/** Drops cached signatures for paths whose file has changed or gone. */
export function forgetSignedUrls(paths: string[]) {
  for (const path of paths) SIGN_CACHE.delete(path);
}

/** True when the query failed only because add-collections.sql has not run. */
function isMissingCollectionColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: string; message?: string };
  return code === '42703' || /column .*(collection|recreated_at|recreated_photo_id)/i.test(message ?? '');
}

function nextMonthStart(year: number, month: number): string {
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
