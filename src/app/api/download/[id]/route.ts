import { NextResponse, type NextRequest } from 'next/server';

import { BUCKET } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';

/**
 * Hands back a one-minute signed link that saves the file instead of opening
 * it. The check below runs before any link is created, so a signed-out request
 * never learns that the photo exists.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { data: allowed } = await supabase
    .from('allowed_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!allowed) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const { data: photo } = await supabase
    .from('photos')
    .select('storage_path, original_name, memory_date')
    .eq('id', id)
    .maybeSingle();
  if (!photo) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const filename = safeFilename(photo.original_name, photo.memory_date);

  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(photo.storage_path, 60, { download: filename });

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not prepare the download.' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Keeps the original name where it is sensible, falls back to the date. */
function safeFilename(originalName: string | null, memoryDate: string): string {
  const base = (originalName ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .slice(0, 60);

  return `${base || `memory-${memoryDate}`}.jpg`;
}
