'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import VideoRecorder from '@/components/VideoRecorder';
import { CameraIcon, CloseIcon, UploadIcon } from '@/components/icons';
import { createReelAction } from '@/lib/actions';
import { BUCKET } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import {
  MAX_VIDEO_SECONDS,
  formatDuration,
  inspectVideo,
  VIDEO_RETENTION_DAYS,
} from '@/lib/video';
import { cn, formatBytes, todayISO } from '@/lib/utils';

type Ready = {
  file: File;
  poster: Blob;
  previewUrl: string;
  posterUrl: string;
  durationSeconds: number;
  width: number;
  height: number;
};

export default function ReelUploader({
  userId,
  onDone,
  onPosted,
}: {
  userId: string;
  onDone: () => void;
  /** Fired after a reel is saved, so the feed can pull it in without a reload. */
  onPosted: () => void | Promise<void>;
}) {
  const router = useRouter();
  const galleryRef = useRef<HTMLInputElement>(null);
  const nativeCameraRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState<Ready | null>(null);
  const [caption, setCaption] = useState('');
  const [memoryDate, setMemoryDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [canRecord, setCanRecord] = useState(false);

  useEffect(() => {
    setCanRecord(
      typeof MediaRecorder !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia &&
        (window.isSecureContext || location.hostname === 'localhost'),
    );
  }, []);

  useEffect(
    () => () => {
      if (ready) {
        URL.revokeObjectURL(ready.previewUrl);
        URL.revokeObjectURL(ready.posterUrl);
      }
    },
    [ready],
  );

  /** Everything is checked here, before a single byte is uploaded. */
  const accept = async (file: File) => {
    setError(null);
    setChecking(true);
    try {
      const result = await inspectVideo(file);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setReady({
        file,
        poster: result.poster,
        previewUrl: URL.createObjectURL(file),
        posterUrl: URL.createObjectURL(result.poster),
        durationSeconds: result.durationSeconds,
        width: result.width,
        height: result.height,
      });
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setProgress(5);

    try {
      const supabase = createClient();
      const id = crypto.randomUUID();
      const videoPath = `photos/${userId}/${id}.mp4`;
      const posterPath = `thumbs/${userId}/${id}.jpg`;

      const posterUpload = await supabase.storage
        .from(BUCKET)
        .upload(posterPath, ready.poster, { contentType: 'image/jpeg', cacheControl: '3600' });
      if (posterUpload.error) throw new Error(posterUpload.error.message);
      setProgress(25);

      const videoUpload = await supabase.storage
        .from(BUCKET)
        .upload(videoPath, ready.file, { contentType: 'video/mp4', cacheControl: '3600' });
      if (videoUpload.error) {
        await supabase.storage.from(BUCKET).remove([posterPath]);
        throw new Error(videoUpload.error.message);
      }
      setProgress(85);

      const result = await createReelAction({
        storage_path: videoPath,
        thumb_path: posterPath,
        caption: caption.trim() || null,
        memory_date: memoryDate,
        duration_seconds: ready.durationSeconds,
        width: ready.width,
        height: ready.height,
        size_bytes: ready.file.size,
        original_name: ready.file.name,
      });

      if (!result.ok) {
        await supabase.storage.from(BUCKET).remove([videoPath, posterPath]);
        throw new Error(result.error);
      }

      setProgress(100);
      router.refresh();
      await onPosted();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that clip.');
      setProgress(0);
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-2xl border border-line bg-bg/60 px-4 py-3 text-base transition-all duration-300 placeholder:text-muted/50 focus:border-accent/50 focus:outline-none sm:text-sm';

  return (
    <div className="card space-y-5 p-6 sm:p-7">
      {recorderOpen && (
        <VideoRecorder
          onCancel={() => setRecorderOpen(false)}
          onUse={async (file) => {
            setRecorderOpen(false);
            await accept(file);
          }}
        />
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="display text-xl">Add a Clip</h2>
          <p className="mt-1 text-sm text-muted">
            Up to {MAX_VIDEO_SECONDS} seconds, 12 MB, MP4.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          aria-label="Close"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink"
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>

      {!ready ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={checking}
              onClick={() => (canRecord ? setRecorderOpen(true) : nativeCameraRef.current?.click())}
              className="sheen min-h-14 flex-1 rounded-2xl border border-line bg-surface/70 px-5 py-4 text-sm font-semibold backdrop-blur-xl transition-all duration-300 hover:border-accent/50 hover:text-accent active:scale-95 disabled:opacity-60"
            >
              <span className="inline-flex items-center justify-center gap-2.5">
                <CameraIcon width={18} height={18} />
                Camera
              </span>
            </button>
            <button
              type="button"
              disabled={checking}
              onClick={() => galleryRef.current?.click()}
              className="sheen min-h-14 flex-1 rounded-2xl bg-gradient-to-br from-accent to-clay px-5 py-4 text-sm font-semibold text-white shadow-glow transition-all duration-300 active:scale-95 disabled:opacity-60"
            >
              <span className="inline-flex items-center justify-center gap-2.5">
                <UploadIcon width={18} height={18} />
                Gallery
              </span>
            </button>
          </div>

          {checking && <p className="text-center text-sm text-muted">Checking that video…</p>}

          <input
            ref={galleryRef}
            type="file"
            accept="video/mp4,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void accept(f);
            }}
          />
          <input
            ref={nativeCameraRef}
            type="file"
            accept="video/mp4,video/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void accept(f);
            }}
          />
        </>
      ) : (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-2xl bg-surface-2">
            {/* preload="none" — the poster is enough until it is played */}
            <video
              src={ready.previewUrl}
              poster={ready.posterUrl}
              controls
              playsInline
              preload="none"
              className="max-h-72 w-full object-contain"
            />
            <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[0.625rem] font-semibold text-white backdrop-blur-md">
              {formatDuration(ready.durationSeconds)} · {formatBytes(ready.file.size)}
            </span>
          </div>

          <label className="block">
            <span className="tracked mb-2.5 block text-[0.625rem] font-semibold text-muted">Caption</span>
            <input
              type="text"
              value={caption}
              maxLength={500}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Say something about it"
              className={field}
            />
          </label>

          <label className="block">
            <span className="tracked mb-2.5 block text-[0.625rem] font-semibold text-muted">
              When did it happen?
            </span>
            <input
              type="date"
              value={memoryDate}
              onChange={(e) => setMemoryDate(e.target.value)}
              className={field}
            />
          </label>

          {busy && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-clay transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setReady(null)}
              className="min-h-12 flex-1 rounded-full border border-line px-4 py-3 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-60"
            >
              Choose another
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="sheen min-h-12 flex-1 rounded-full bg-gradient-to-br from-accent to-clay px-4 py-3 text-sm font-semibold text-white shadow-glow transition disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Post clip'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-danger">
          {error}
        </p>
      )}

      <p className="text-center text-xs text-muted/70">
        Video memories are kept for {VIDEO_RETENTION_DAYS} days.
      </p>
    </div>
  );
}
