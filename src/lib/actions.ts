'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { BUCKET } from '@/lib/constants';
import { forgetSignedUrls, getPhotos } from '@/lib/photos';
import type { Collection, Photo, PhotoComment, PhotoFilter } from '@/lib/types';

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Refreshes every page that can show photos. */
function revalidateAll() {
  revalidatePath('/', 'layout');
}

/**
 * Confirms the caller is signed in AND on the allow list. Every mutation below
 * starts here; the database policies enforce the same rule a second time.
 */
async function requireViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You need to sign in.');

  const { data: allowed } = await supabase
    .from('allowed_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!allowed) throw new Error('This account is not part of this album.');
  return { supabase, user };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signInAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { ok: false, error: 'Please fill in both fields.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { ok: false, error: 'That email and password do not match.' };
  }

  // A correct password is not enough — the account must also be on the list.
  const { data: allowed } = await supabase
    .from('allowed_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!allowed) {
    await supabase.auth.signOut();
    return { ok: false, error: 'This account does not have access to this album.' };
  }

  revalidateAll();
  return { ok: true };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidateAll();
  redirect('/login');
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type NewPhotoInput = {
  storage_path: string;
  thumb_path: string;
  caption: string | null;
  memory_date: string;
  is_special: boolean;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  original_name: string | null;
};

/**
 * Called once after the browser has finished uploading the image bytes
 * directly to Storage. Writes the metadata rows for the whole batch.
 */
export async function createPhotosAction(
  items: NewPhotoInput[],
  collection: Collection = 'moment',
): Promise<ActionResult & { ids?: string[] }> {
  try {
    const { supabase, user } = await requireViewer();
    if (items.length === 0) return { ok: false, error: 'No photos to save.' };

    const rows = items.map((item) => ({
      uploader_id: user.id,
      storage_path: item.storage_path,
      thumb_path: item.thumb_path,
      caption: item.caption?.trim() || null,
      memory_date: item.memory_date,
      is_special: item.is_special,
      width: item.width,
      height: item.height,
      size_bytes: item.size_bytes,
      original_name: item.original_name,
    }));

    const withCollection = rows.map((r) => ({ ...r, collection }));
    const { data, error } = await supabase.from('photos').insert(withCollection).select('id');
    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true, ids: (data ?? []).map((r) => r.id) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function updatePhotoAction(
  id: string,
  patch: { caption?: string | null; memory_date?: string; is_special?: boolean },
): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const update: Record<string, unknown> = {};
    if ('caption' in patch) update.caption = patch.caption?.trim() || null;
    if (patch.memory_date) update.memory_date = patch.memory_date;
    if (typeof patch.is_special === 'boolean') update.is_special = patch.is_special;

    if (Object.keys(update).length === 0) return { ok: true };

    const { error } = await supabase.from('photos').update(update).eq('id', id);
    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Removes the row and both image files. */
export async function deletePhotoAction(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const { data: photo, error: findError } = await supabase
      .from('photos')
      .select('storage_path, thumb_path')
      .eq('id', id)
      .maybeSingle();

    if (findError) return { ok: false, error: findError.message };
    if (!photo) return { ok: false, error: 'That photo is already gone.' };

    const { error: deleteError } = await supabase.from('photos').delete().eq('id', id);
    if (deleteError) return { ok: false, error: deleteError.message };

    // Files go last: an orphaned file is harmless, an orphaned row is not.
    await supabase.storage.from(BUCKET).remove([photo.storage_path, photo.thumb_path]);
    forgetSignedUrls([photo.storage_path, photo.thumb_path]);

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Called after the browser has replaced an edited image in Storage. The image
 * keeps its original storage_path, so the row's id, uploader, favorites and
 * special flag are untouched. Its caption/date can be committed alongside the
 * new dimensions in the same row update.
 */
export async function updatePhotoImageAction(
  id: string,
  size: { width: number; height: number; size_bytes: number },
  patch?: { caption?: string | null; memory_date?: string },
): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      !Number.isFinite(size.size_bytes) ||
      size.width <= 0 ||
      size.height <= 0 ||
      size.size_bytes <= 0
    ) {
      return { ok: false, error: 'The edited photo had invalid dimensions.' };
    }

    const update: Record<string, unknown> = {
      width: Math.round(size.width),
      height: Math.round(size.height),
      size_bytes: Math.round(size.size_bytes),
    };
    if (patch && 'caption' in patch) update.caption = patch.caption?.trim() || null;
    if (patch?.memory_date) update.memory_date = patch.memory_date;

    const { error } = await supabase.from('photos').update(update).eq('id', id);

    if (error) return { ok: false, error: error.message };

    // The bytes at this path were just replaced while the path stayed the
    // same, so drop the cached signature — otherwise the old picture would
    // keep being served until the URL expired.
    const { data: paths } = await supabase
      .from('photos')
      .select('storage_path, thumb_path')
      .eq('id', id)
      .maybeSingle();
    if (paths) forgetSignedUrls([paths.storage_path, paths.thumb_path]);

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function toggleFavoriteAction(
  id: string,
  makeFavorite: boolean,
): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireViewer();

    const { error } = makeFavorite
      ? await supabase.from('favorites').upsert({ photo_id: id, user_id: user.id })
      : await supabase.from('favorites').delete().eq('photo_id', id).eq('user_id', user.id);

    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

// ---------------------------------------------------------------------------
// Reels (short video memories)
// ---------------------------------------------------------------------------

export type NewReelInput = {
  storage_path: string;
  thumb_path: string;
  caption: string | null;
  memory_date: string;
  duration_seconds: number;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  original_name: string | null;
};

/** How long a video memory is kept. Mirrors VIDEO_RETENTION_DAYS. */
const VIDEO_RETENTION_DAYS = 60;

/**
 * Saves a reel once the browser has uploaded the video and its poster.
 *
 * expires_at is stamped here rather than trusted from the client, so the
 * retention window cannot be extended from the browser. The database also
 * insists a video HAS an expiry and a photo has none.
 */
export async function createReelAction(item: NewReelInput): Promise<ActionResult & { id?: string }> {
  try {
    const { supabase, user } = await requireViewer();

    if (!(item.duration_seconds > 0) || item.duration_seconds > 46) {
      return { ok: false, error: 'Video must be 45 seconds or shorter.' };
    }
    if ((item.size_bytes ?? 0) > 12 * 1024 * 1024) {
      return { ok: false, error: 'Video must be 12 MB or smaller.' };
    }

    const { data, error } = await supabase
      .from('photos')
      .insert({
        uploader_id: user.id,
        storage_path: item.storage_path,
        thumb_path: item.thumb_path,
        caption: item.caption?.trim() || null,
        memory_date: item.memory_date,
        is_special: false,
        collection: 'moment',
        media_kind: 'video',
        expires_at: new Date(Date.now() + VIDEO_RETENTION_DAYS * 86_400_000).toISOString(),
        duration_seconds: item.duration_seconds,
        width: item.width,
        height: item.height,
        size_bytes: item.size_bytes,
        original_name: item.original_name,
      })
      .select('id')
      .single();

    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** One page of reels, for the load-more button. */
export async function loadMoreReelsAction(offset: number): Promise<Photo[]> {
  await requireViewer();
  return getPhotos({ mediaKind: 'video', sort: 'created', limit: 24, offset });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Posts a comment as the signed-in person. The database also enforces
 * author_id = auth.uid(), so a comment can never be attributed to the other
 * person even if this code were wrong.
 */
export async function addCommentAction(
  photoId: string,
  body: string,
): Promise<ActionResult & { comment?: PhotoComment }> {
  try {
    const { supabase, user } = await requireViewer();

    const text = body.trim();
    if (!text) return { ok: false, error: 'Write something first.' };
    if (text.length > 2000) return { ok: false, error: 'That is too long — keep it under 2000 characters.' };

    const { data, error } = await supabase
      .from('comments')
      .insert({ photo_id: photoId, author_id: user.id, body: text })
      .select('id, photo_id, author_id, body, created_at')
      .single();

    if (error) return { ok: false, error: error.message };

    const { data: me } = await supabase
      .from('allowed_users')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle();

    revalidateAll();
    return {
      ok: true,
      comment: {
        id: data.id,
        photo_id: data.photo_id,
        author_id: data.author_id,
        authorName: me?.display_name ?? 'Someone',
        body: data.body,
        created_at: data.created_at,
        isMine: true,
      },
    };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Edits your own comment. The RLS policy rejects anyone else's. */
export async function editCommentAction(id: string, body: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const text = body.trim();
    if (!text) return { ok: false, error: 'Write something first.' };
    if (text.length > 2000) return { ok: false, error: 'That is too long — keep it under 2000 characters.' };

    const { data, error } = await supabase
      .from('comments')
      .update({ body: text })
      .eq('id', id)
      .select('id');

    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: 'You can only edit your own comments.' };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Removes your own comment. Neither of you can delete the other's words. */
export async function deleteCommentAction(id: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const { data, error } = await supabase
      .from('comments')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: 'You can only remove your own comments.' };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

// ---------------------------------------------------------------------------
// Collections: Our Moments and Recreate Someday
// ---------------------------------------------------------------------------

/**
 * Moves one item between the two collections. Nothing is copied and no file is
 * touched — only the row's collection changes, so storage can never end up
 * with duplicates or orphans.
 */
export async function moveToCollectionAction(
  id: string,
  collection: Collection,
  memoryDate?: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const update: Record<string, unknown> = { collection };

    // A real memory needs a date it actually happened.
    if (collection === 'moment' && memoryDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(memoryDate)) {
        return { ok: false, error: 'Please give a valid date for the memory.' };
      }
      update.memory_date = memoryDate;
    }

    // Going back to inspiration clears any recreation link.
    if (collection === 'inspiration') {
      update.recreated_photo_id = null;
      update.recreated_at = null;
    }

    const { data, error } = await supabase.from('photos').update(update).eq('id', id).select('id');
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: 'That item no longer exists.' };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Links an inspiration to the real memory we made of it and marks it
 * recreated. The inspiration picture itself is never copied into Our Moments —
 * the newly uploaded photo is the memory, and the inspiration stays put as the
 * "before" half of the pair.
 */
export async function markRecreatedAction(
  inspirationId: string,
  recreatedPhotoId: string,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const { data: pair } = await supabase
      .from('photos')
      .select('id, collection')
      .in('id', [inspirationId, recreatedPhotoId]);

    const inspiration = pair?.find((r) => r.id === inspirationId);
    const memory = pair?.find((r) => r.id === recreatedPhotoId);

    if (!inspiration || !memory) return { ok: false, error: 'Could not find both items.' };
    if (inspiration.collection !== 'inspiration') {
      return { ok: false, error: 'That item is not in Recreate Someday.' };
    }
    if (memory.collection !== 'moment') {
      return { ok: false, error: 'The recreated photo must be an Our Moment.' };
    }

    const { error } = await supabase
      .from('photos')
      .update({ recreated_photo_id: recreatedPhotoId, recreated_at: new Date().toISOString() })
      .eq('id', inspirationId);

    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Puts a recreated inspiration back on the to-do list. */
export async function unmarkRecreatedAction(inspirationId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();
    const { error } = await supabase
      .from('photos')
      .update({ recreated_photo_id: null, recreated_at: null })
      .eq('id', inspirationId);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Used by the "load more" button on the gallery and timeline. */
export async function loadMorePhotosAction(filter: PhotoFilter): Promise<Photo[]> {
  await requireViewer();
  return getPhotos(filter);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettingsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireViewer();

    const startDate = String(formData.get('relationship_start_date') ?? '').trim();
    const title = String(formData.get('home_title') ?? '').trim();
    const quote = String(formData.get('home_quote') ?? '').trim();
    const displayName = String(formData.get('display_name') ?? '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return { ok: false, error: 'Please pick a valid start date.' };
    }
    if (!title) return { ok: false, error: 'The title cannot be empty.' };
    if (!displayName) return { ok: false, error: 'Your name cannot be empty.' };

    const { error: settingsError } = await supabase.from('app_settings').upsert(
      [
        { key: 'relationship_start_date', value: startDate },
        { key: 'home_title', value: title },
        { key: 'home_quote', value: quote },
      ],
      { onConflict: 'key' },
    );
    if (settingsError) return { ok: false, error: settingsError.message };

    const { error: nameError } = await supabase
      .from('allowed_users')
      .update({ display_name: displayName })
      .eq('user_id', user.id);
    if (nameError) return { ok: false, error: nameError.message };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { supabase } = await requireViewer();

    const password = String(formData.get('new_password') ?? '');
    const confirm = String(formData.get('confirm_password') ?? '');

    if (password.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
    if (password !== confirm) return { ok: false, error: 'The two passwords do not match.' };

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.';
}
