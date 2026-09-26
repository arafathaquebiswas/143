/**
 * Client-side checks for a video BEFORE anything is uploaded.
 *
 * Nothing here transcodes. The browser decodes a frame it was going to decode
 * anyway to show a preview, and we read the metadata it already has. That
 * keeps phones cool and the page responsive.
 */

export const MAX_VIDEO_SECONDS = 45;
export const MAX_VIDEO_BYTES = 12 * 1024 * 1024; // 12 MB
export const VIDEO_RETENTION_DAYS = 60;

/** The one container/codec pair both of us can reliably play everywhere. */
export const ACCEPTED_VIDEO_TYPES = ['video/mp4'];

export type VideoCheck =
  | { ok: true; durationSeconds: number; width: number; height: number; poster: Blob }
  | { ok: false; reason: string };

function prettyMB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Validates type, size and duration, and grabs a poster frame.
 * Everything is checked locally; nothing leaves the device unless it passes.
 */
export async function inspectVideo(file: File): Promise<VideoCheck> {
  // --- format, before anything else ---------------------------------------
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();

  if (!ACCEPTED_VIDEO_TYPES.includes(type)) {
    // iPhone records HEVC in .mov by default. Safari plays it; Chrome and
    // Firefox usually do not, so saving it would give one of us a memory the
    // other cannot watch.
    if (type === 'video/quicktime' || name.endsWith('.mov')) {
      return {
        ok: false,
        reason:
          'That looks like an iPhone .mov video, which will not play for both of us. ' +
          'On your iPhone open Settings, Camera, Formats and choose Most Compatible, then record again.',
      };
    }
    return {
      ok: false,
      reason: `${type || 'That file'} is not supported. Videos need to be MP4.`,
    };
  }

  // --- size, before reading a single frame --------------------------------
  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      reason:
        `Video must be ${MAX_VIDEO_SECONDS} seconds or shorter and 12 MB or smaller. ` +
        `This one is ${prettyMB(file.size)}.`,
    };
  }

  // --- duration and a poster frame ----------------------------------------
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const meta = await new Promise<{ duration: number; width: number; height: number } | null>(
      (resolve) => {
        const done = () =>
          resolve({
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          });
        video.onloadedmetadata = done;
        video.onerror = () => resolve(null);
        setTimeout(() => resolve(null), 15000);
      },
    );

    if (!meta || !Number.isFinite(meta.duration) || meta.duration <= 0) {
      return {
        ok: false,
        reason: 'This browser could not read that video. Try an MP4 recorded on this device.',
      };
    }

    if (meta.duration > MAX_VIDEO_SECONDS + 0.5) {
      return {
        ok: false,
        reason:
          `Video must be ${MAX_VIDEO_SECONDS} seconds or shorter and 12 MB or smaller. ` +
          `This one is ${Math.round(meta.duration)} seconds.`,
      };
    }

    // Seek a little way in: frame zero is often black.
    const poster = await new Promise<Blob | null>((resolve) => {
      const grab = () => {
        const canvas = document.createElement('canvas');
        canvas.width = meta.width || 720;
        canvas.height = meta.height || 1280;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.72);
      };
      video.onseeked = grab;
      video.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 15000);
      try {
        video.currentTime = Math.min(0.2, meta.duration / 2);
      } catch {
        grab();
      }
    });

    if (!poster) {
      return {
        ok: false,
        reason: 'Could not read a preview frame from that video. Try a different one.',
      };
    }

    return {
      ok: true,
      durationSeconds: Math.round(meta.duration * 10) / 10,
      width: meta.width || 720,
      height: meta.height || 1280,
      poster,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "Expires in 12 days", or null for a photo. */
export function daysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** 60 days from now, as the database wants it. */
export function expiryFromNow(): string {
  return new Date(Date.now() + VIDEO_RETENTION_DAYS * 86_400_000).toISOString();
}

/** "0:42" */
export function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
