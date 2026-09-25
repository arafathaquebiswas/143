'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { BUCKET } from '@/lib/constants';
import { getPhotos } from '@/lib/photos';
import type { Photo, PhotoFilter } from '@/lib/types';

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
export async function createPhotosAction(items: NewPhotoInput[]): Promise<ActionResult> {
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

    const { error } = await supabase.from('photos').insert(rows);
    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true };
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
