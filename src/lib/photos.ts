import 'server-only';

import { BUCKET, PAGE_SIZE, SIGNED_URL_TTL } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';
import type { AppSettings, Person, Photo, PhotoFilter, PhotoRow } from '@/lib/types';

const DEFAULT_SETTINGS: AppSettings = {
  relationship_start_date: '2024-01-01',
  home_title: 'Our Little World',
  home_quote: 'Distance means so little when someone means so much.',
};

/** The logged-in person, plus the other half of the album. */
export async function getViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: roster } = await supabase
    .from('allowed_users')
    .select('user_id, display_name')
    .order('created_at');

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
}

export async function getSettings(): Promise<AppSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from('app_settings').select('key, value');

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (row.key in settings && row.value) {
      settings[row.key as keyof AppSettings] = row.value;
    }
  }
  return settings;
}

type PhotoQueryRow = PhotoRow & { uploader: { display_name: string } | null };

/**
 * Loads photos and turns them into render-ready objects: signed image links,
 * uploader name and heart state, all resolved in a handful of round trips.
 */
export async function getPhotos(filter: PhotoFilter = {}): Promise<Photo[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const {
    year,
    month,
    specialOnly = false,
    favoritesOnly = false,
    sort = 'memory',
    limit = PAGE_SIZE,
    offset = 0,
  } = filter;

  // Favorites are needed both as a filter and as display state, so fetch the
  // (small) full set up front.
  const { data: favRows } = await supabase.from('favorites').select('photo_id, user_id');
  const favorites = favRows ?? [];

  // The foreign key is named explicitly: photos and allowed_users are related
  // twice (uploader_id, and again through favorites), so PostgREST needs to be
  // told which path to follow or it refuses the embed with PGRST201.
  let query = supabase
    .from('photos')
    .select('*, uploader:allowed_users!photos_uploader_id_fkey(display_name)')
    .range(offset, offset + limit - 1);

  query =
    sort === 'created'
      ? query.order('created_at', { ascending: false })
      : query.order('memory_date', { ascending: false }).order('created_at', { ascending: false });

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

  const { data, error } = await query;
  if (error) throw new Error(`Could not load photos: ${error.message}`);

  const rows = (data ?? []) as PhotoQueryRow[];
  if (rows.length === 0) return [];

  const { data: roster } = await supabase.from('allowed_users').select('user_id, display_name');
  const nameOf = new Map((roster ?? []).map((p) => [p.user_id, p.display_name]));

  // One batched signing call for every thumbnail and full-size image.
  const paths = rows.flatMap((r) => [r.thumb_path, r.storage_path]);
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
    } satisfies Photo;
  });
}

/** Totals for the little stat row on the homepage. */
export async function getCounts() {
  const supabase = await createClient();

  const [photos, special, favorites] = await Promise.all([
    supabase.from('photos').select('id', { count: 'exact', head: true }),
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('is_special', true),
    supabase.from('favorites').select('photo_id', { count: 'exact', head: true }),
  ]);

  return {
    photos: photos.count ?? 0,
    special: special.count ?? 0,
    favorites: favorites.count ?? 0,
  };
}

/** Distinct years that actually have memories in them, newest first. */
export async function getYearsWithMemories(): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('photos')
    .select('memory_date')
    .order('memory_date', { ascending: false });

  const years = new Set<number>();
  for (const row of data ?? []) years.add(Number(row.memory_date.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

/** Signs a batch of storage paths, returning path -> temporary URL. */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)].filter(Boolean);
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const supabase = await createClient();

  // Sign in chunks so a very large album never sends one enormous request.
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(slice, SIGNED_URL_TTL);
    for (const entry of data ?? []) {
      if (entry.signedUrl && entry.path) result.set(entry.path, entry.signedUrl);
    }
  }
  return result;
}

function nextMonthStart(year: number, month: number): string {
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}
