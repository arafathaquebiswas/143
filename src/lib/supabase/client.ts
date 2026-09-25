'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for the browser. Used for signing in and for uploading image
 * bytes straight from the phone to Storage, so photo data never passes through
 * our own server.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
