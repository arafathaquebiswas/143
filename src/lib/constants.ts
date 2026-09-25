/** Values shared by both server and client code. Safe to import anywhere. */

/** How many photos are fetched per page / per "load more" tap. */
export const PAGE_SIZE = 48;

/** The private Supabase Storage bucket holding every image. */
export const BUCKET = 'memories';

/** How long a signed photo link stays valid. Long enough to browse an album,
 *  short enough that a leaked link is worthless tomorrow. */
export const SIGNED_URL_TTL = 60 * 60 * 2;

/** Longest edge, in pixels, for the stored full-size image. */
export const FULL_MAX_EDGE = 2048;

/** Longest edge for the gallery thumbnail. */
export const THUMB_MAX_EDGE = 640;

/** Target size after compression, in megabytes. */
export const FULL_MAX_MB = 1.6;
export const THUMB_MAX_MB = 0.12;

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
];
