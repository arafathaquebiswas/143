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

    // One notification per upload, not per photo: adding twelve at once should
    // say "added a new memory" once, not twelve times. It opens the first of
    // them, and the rest are right beside it.
    //
    // Which collection it went to decides the wording, so a Recreate Someday
    // item never announces itself as a new memory.
    const first = (data ?? [])[0];
    if (first) {
      await notifyPartner(
        supabase,
        user.id,
        collection === 'inspiration' ? 'recreate' : 'photo',
        { photoId: first.id },
      );
    }

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

    // A love only travels when it is about the OTHER person's item. Loving
    // your own upload tells nobody, because the only person it could reach is
    // you. Un-loving takes an unread love notice back with it.
    if (makeFavorite) {
      const { data: target } = await supabase
        .from('photos')
        .select('uploader_id')
        .eq('id', id)
        .maybeSingle();

      if (target && target.uploader_id !== user.id) {
        await notifyPartner(supabase, user.id, 'favorite', { photoId: id });
      }
    } else {
      await retractFavoriteNotice(supabase, id);
    }

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

    await notifyPartner(supabase, user.id, 'reel', { photoId: data.id });

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

    // Which kind of thing was commented on decides the wording and the link.
    const { data: target } = await supabase
      .from('photos')
      .select('media_kind')
      .eq('id', photoId)
      .maybeSingle();
    await notifyPartner(
      supabase,
      user.id,
      target?.media_kind === 'video' ? 'comment_reel' : 'comment_photo',
      { photoId, commentId: data.id },
    );

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
// Notifications
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'photo'
  | 'recreate'
  | 'reel'
  | 'favorite'
  | 'comment_photo'
  | 'comment_reel';

export type AppNotification = {
  id: string;
  type: NotificationType;
  actorName: string;
  photoId: string;
  commentId: string | null;
  isRead: boolean;
  createdAt: string;
  thumbUrl: string | null;
  mediaKind: 'photo' | 'video' | null;
  /** True when the item this is about belongs to the person reading it. */
  targetIsMine: boolean;
};

/** True when supabase/add-notifications.sql has not been run yet. */
function tableMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: string; message?: string };
  return code === 'PGRST205' || code === '42P01' || /notifications.*(does not exist|schema cache)/i.test(message ?? '');
}

/**
 * Tells the OTHER person that something happened. Never the actor themselves —
 * the insert policy and a CHECK constraint enforce that in the database too.
 *
 * A notification must never make an upload, a note or a love appear to fail,
 * so this never throws. It does NOT swallow blindly, though: the previous
 * version discarded the result object, which is why a missing table went
 * unnoticed for so long. Now a real failure is logged, and only the two
 * expected outcomes are treated as success.
 */
async function notifyPartner(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
  type: NotificationType,
  target: { photoId: string; commentId?: string },
) {
  try {
    const { data: others, error: rosterError } = await supabase
      .from('allowed_users')
      .select('user_id')
      .neq('user_id', actorId);

    if (rosterError) {
      console.error('[notify] could not read the roster:', rosterError.message);
      return;
    }

    for (const other of others ?? []) {
      const { error } = await supabase.from('notifications').insert({
        recipient_id: other.user_id,
        actor_id: actorId,
        type,
        photo_id: target.photoId,
        comment_id: target.commentId ?? null,
      });

      // 23505 = the unique index refused a repeat. That is the duplicate
      // protection doing its job, so it counts as success.
      if (error && error.code !== '23505') {
        console.error(
          tableMissing(error)
            ? '[notify] supabase/add-notifications.sql has not been run yet'
            : `[notify] ${type} failed: ${error.message}`,
        );
      }
    }
  } catch (e) {
    console.error('[notify] unexpected:', message(e));
  }
}

/**
 * Undoes the love notification when a love is taken back, so a mis-tap does
 * not leave "Arafat loved your memory" sitting in her inbox.
 *
 * This has to go through a database function rather than a plain delete.
 * Postgres applies the SELECT policies when it locates rows for a DELETE, and
 * that policy hides the other person's inbox on purpose — so the sender can
 * never find their own sent row to remove it. The function is SECURITY
 * DEFINER with actor_id pinned to the caller, which keeps the inbox private
 * while still allowing exactly this one retraction.
 */
async function retractFavoriteNotice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  photoId: string,
) {
  try {
    const { error } = await supabase.rpc('retract_favorite_notification', {
      p_photo_id: photoId,
    });
    if (error && !tableMissing(error) && error.code !== 'PGRST202') {
      console.error(`[notify] could not retract the love notice: ${error.message}`);
    }
  } catch {
    /* taking the love back still succeeded; nothing here is worth failing on */
  }
}

/** Newest first. Only ever your own inbox — RLS sees to that. */
export async function listNotificationsAction(
  limit = 20,
  offset = 0,
): Promise<{ items: AppNotification[]; unread: number; available: boolean }> {
  try {
    const { supabase, user } = await requireViewer();

    const now = new Date().toISOString();

    // Anything past its 21 days is treated as gone the moment it expires,
    // whether or not the daily purge has run yet.
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, actor_id, photo_id, comment_id, is_read, created_at')
      .eq('recipient_id', user.id)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      if (tableMissing(error)) return { items: [], unread: 0, available: false };
      return { items: [], unread: 0, available: true };
    }

    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .gt('expires_at', now)
      .eq('is_read', false);

    const { data: roster } = await supabase.from('allowed_users').select('user_id, display_name');
    const nameOf = new Map((roster ?? []).map((p) => [p.user_id, p.display_name]));

    // Only the poster/thumbnail is ever fetched here — never a full photo,
    // and never an mp4.
    const photoIds = [...new Set((data ?? []).map((n) => n.photo_id).filter(Boolean))] as string[];
    // uploader_id rides along so the wording can say "your memory" only when
    // it really is hers — it costs nothing, the row is already being read.
    const { data: targets } = photoIds.length
      ? await supabase
          .from('photos')
          .select('id, thumb_path, media_kind, uploader_id')
          .in('id', photoIds)
      : {
          data: [] as {
            id: string;
            thumb_path: string;
            media_kind: 'photo' | 'video';
            uploader_id: string;
          }[],
        };

    const signed = new Map<string, string>();
    if ((targets ?? []).length) {
      const { data: urls } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls((targets ?? []).map((t) => t.thumb_path), 7200);
      for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
    }

    const items: AppNotification[] = (data ?? []).map((n) => {
      const target = (targets ?? []).find((t) => t.id === n.photo_id);
      return {
        id: n.id,
        type: n.type,
        actorName: nameOf.get(n.actor_id) ?? 'Someone',
        photoId: n.photo_id,
        commentId: n.comment_id,
        isRead: n.is_read,
        createdAt: n.created_at,
        thumbUrl: target ? (signed.get(target.thumb_path) ?? null) : null,
        mediaKind: target?.media_kind ?? null,
        targetIsMine: target?.uploader_id === user.id,
      };
    });

    return { items, unread: count ?? 0, available: true };
  } catch {
    return { items: [], unread: 0, available: false };
  }
}

/**
 * Just the badge number. The bell lives in the navbar, so this runs on every
 * page load — it must stay a single HEAD count and nothing else. The full
 * list, with its roster lookup and signed thumbnails, is only fetched when
 * the panel is actually opened.
 */
export async function getUnreadCountAction(): Promise<{ unread: number; available: boolean }> {
  try {
    // Deliberately NOT requireViewer(). This runs on every page load, and
    // requireViewer costs an auth.getUser round trip (measured 214 ms) plus an
    // allowed_users query — to scope a count the database already scopes.
    //
    // The inbox SELECT policy is "is_allowed() AND recipient_id = auth.uid()",
    // so this cannot see another person's rows without an explicit
    // recipient_id match, and someone off the allow list counts zero. Nothing
    // is trusted from the client: the JWT still comes from the cookie.
    const supabase = await createClient();

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString())
      .eq('is_read', false);

    if (error) return { unread: 0, available: !tableMissing(error) };
    return { unread: count ?? 0, available: true };
  } catch {
    return { unread: 0, available: false };
  }
}

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireViewer();
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('recipient_id', user.id);
    if (error && !tableMissing(error)) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireViewer();
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', user.id)
      .eq('is_read', false);
    if (error && !tableMissing(error)) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
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
