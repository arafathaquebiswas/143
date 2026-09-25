'use client';

import imageCompression from 'browser-image-compression';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import CameraCapture from '@/components/CameraCapture';
import { CameraIcon, CheckIcon, CloseIcon, StarIcon, UploadIcon } from '@/components/icons';
import { createPhotosAction, markRecreatedAction, type NewPhotoInput } from '@/lib/actions';
import {
  ACCEPTED_IMAGE_TYPES,
  BUCKET,
  FULL_MAX_EDGE,
  FULL_MAX_MB,
  THUMB_MAX_EDGE,
  THUMB_MAX_MB,
} from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import type { Collection } from '@/lib/types';
import { cn, formatBytes, todayISO } from '@/lib/utils';

type Status = 'ready' | 'working' | 'done' | 'failed';

type Item = {
  key: string;
  file: File;
  previewUrl: string;
  caption: string;
  status: Status;
  progress: number;
  error?: string;
};

export default function UploadClient({
  userId,
  /** When set, this upload becomes the real memory for that inspiration. */
  recreateFor,
  recreateCaption,
}: {
  userId: string;
  recreateFor?: string;
  recreateCaption?: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Native camera picker — the fallback where live capture is unavailable. */
  const nativeCameraRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [collection, setCollection] = useState<Collection>('moment');
  const [cameraSupported, setCameraSupported] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [memoryDate, setMemoryDate] = useState(todayISO());
  const [useFileDates, setUseFileDates] = useState(false);
  const [sharedCaption, setSharedCaption] = useState('');
  const [markSpecial, setMarkSpecial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Live capture needs getUserMedia in a secure context. Detected after mount
  // so the server and the first client render agree.
  useEffect(() => {
    setCameraSupported(
      !!navigator.mediaDevices?.getUserMedia &&
        (window.isSecureContext || location.hostname === 'localhost'),
    );
  }, []);

  // Object URLs are a finite resource; release them when the list changes.
  useEffect(
    () => () => {
      for (const item of items) URL.revokeObjectURL(item.previewUrl);
    },
    [items],
  );

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const accepted: Item[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      const typeOk = ACCEPTED_IMAGE_TYPES.includes(file.type) || /\.(hei[cf])$/i.test(file.name);
      if (!typeOk) {
        rejected.push(file.name);
        continue;
      }
      accepted.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        caption: '',
        status: 'ready',
        progress: 0,
      });
    }

    setItems((current) => [...current, ...accepted]);
    setNotice(
      rejected.length > 0
        ? `Skipped ${rejected.length} file${rejected.length === 1 ? '' : 's'} that are not images.`
        : null,
    );
  };

  const patch = (key: string, changes: Partial<Item>) =>
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...changes } : i)));

  const removeItem = (key: string) =>
    setItems((current) => {
      const target = current.find((i) => i.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((i) => i.key !== key);
    });

  const upload = async () => {
    const pending = items.filter((i) => i.status === 'ready' || i.status === 'failed');
    if (pending.length === 0) return;

    setBusy(true);
    setNotice(null);
    const supabase = createClient();
    const saved: NewPhotoInput[] = [];

    for (const item of pending) {
      patch(item.key, { status: 'working', progress: 2, error: undefined });

      try {
        const id = crypto.randomUUID();
        const fullPath = `photos/${userId}/${id}.jpg`;
        const thumbPath = `thumbs/${userId}/${id}.jpg`;

        // Shrink on the phone so we never move more bytes than we need to.
        const full = await imageCompression(item.file, {
          maxSizeMB: FULL_MAX_MB,
          maxWidthOrHeight: FULL_MAX_EDGE,
          useWebWorker: true,
          fileType: 'image/jpeg',
          initialQuality: 0.86,
          onProgress: (p) => patch(item.key, { progress: Math.round(p * 0.45) }),
        });

        const thumb = await imageCompression(item.file, {
          maxSizeMB: THUMB_MAX_MB,
          maxWidthOrHeight: THUMB_MAX_EDGE,
          useWebWorker: true,
          fileType: 'image/jpeg',
          initialQuality: 0.74,
          onProgress: (p) => patch(item.key, { progress: 45 + Math.round(p * 0.2) }),
        });

        const size = await readDimensions(full);
        patch(item.key, { progress: 70 });

        const fullUpload = await supabase.storage
          .from(BUCKET)
          .upload(fullPath, full, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (fullUpload.error) throw new Error(fullUpload.error.message);

        patch(item.key, { progress: 90 });

        const thumbUpload = await supabase.storage
          .from(BUCKET)
          .upload(thumbPath, thumb, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
        if (thumbUpload.error) {
          await supabase.storage.from(BUCKET).remove([fullPath]);
          throw new Error(thumbUpload.error.message);
        }

        saved.push({
          storage_path: fullPath,
          thumb_path: thumbPath,
          caption: item.caption.trim() || sharedCaption.trim() || null,
          memory_date: useFileDates ? fileDate(item.file) : memoryDate,
          is_special: markSpecial,
          width: size.width,
          height: size.height,
          size_bytes: full.size,
          original_name: item.file.name,
        });

        patch(item.key, { status: 'done', progress: 100 });
      } catch (e) {
        patch(item.key, {
          status: 'failed',
          progress: 0,
          error: e instanceof Error ? e.message : 'Upload failed.',
        });
      }
    }

    if (saved.length > 0) {
      // In recreate mode the new photo is always a real memory.
      const target: Collection = recreateFor ? 'moment' : collection;
      const result = await createPhotosAction(saved, target);
      if (!result.ok) {
        setNotice(`Photos uploaded but could not be saved: ${result.error}`);
        setBusy(false);
        return;
      }

      if (recreateFor && result.ids?.length) {
        const link = await markRecreatedAction(recreateFor, result.ids[0]);
        if (!link.ok) {
          setNotice(`Saved, but could not link it to the inspiration: ${link.error}`);
          setBusy(false);
          return;
        }
      }

      router.refresh();
      router.push(recreateFor ? '/recreate' : target === 'inspiration' ? '/recreate' : '/gallery');
      return;
    }

    setNotice('Nothing could be uploaded. Check the errors below and try again.');
    setBusy(false);
  };

  const readyCount = items.filter((i) => i.status === 'ready' || i.status === 'failed').length;
  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0);

  return (
    <div className="space-y-6">
      {recreateFor && (
        <div className="card animate-reveal flex items-start gap-3.5 border-accent/30 bg-accent-soft/50 p-5">
          <span className="mt-0.5 shrink-0 text-accent">
            <StarIcon filled width={18} height={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Recreating an inspiration</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {recreateCaption
                ? `"${recreateCaption}" becomes a real memory once you add your photo.`
                : 'Your photo becomes a real memory in Our Moments, and the original stays in Recreate Someday as the before.'}
            </p>
          </div>
        </div>
      )}

      {cameraOpen && (
        <CameraCapture
          onCancel={() => setCameraOpen(false)}
          onUse={(file) => {
            // Exactly the same path as a gallery photo: compression, thumbnail,
            // private Storage upload, database row, RLS. Nothing is duplicated.
            addFiles([file]);
            setCameraOpen(false);
          }}
        />
      )}
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'relative overflow-hidden rounded-[var(--radius-xl2)] border-2 border-dashed px-7 py-14 text-center transition-all duration-500',
          dragging
            ? 'border-accent bg-accent-soft/60 scale-[1.01]'
            : 'border-line-strong/70 bg-surface/40 hover:border-accent/40',
        )}
      >
        <span className="animate-breathe mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-accent/15 to-clay/10 text-accent ring-1 ring-accent/15">
          <CameraIcon width={26} height={26} />
        </span>
        <h2 className="display text-2xl">
          {recreateFor ? 'Your recreation' : 'Add a memory'}
        </h2>

        {/* Which collection is this going into? Hidden in recreate mode,
            where the answer is always Our Moments. */}
        {!recreateFor && (
          <div className="mx-auto mt-6 inline-flex rounded-full border border-line bg-surface/60 p-1 backdrop-blur-xl">
            {([
              { key: 'moment', label: 'Our Moment', hint: 'It happened' },
              { key: 'inspiration', label: 'Recreate Someday', hint: 'For later' },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setCollection(opt.key)}
                aria-pressed={collection === opt.key}
                className={cn(
                  'min-h-11 rounded-full px-5 py-2.5 text-[0.8125rem] font-semibold transition-all duration-300',
                  collection === opt.key
                    ? 'bg-gradient-to-br from-accent to-clay text-white shadow-soft'
                    : 'text-muted hover:text-ink',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        <div className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => (cameraSupported ? setCameraOpen(true) : nativeCameraRef.current?.click())}
            className="sheen min-h-14 flex-1 rounded-2xl border border-line bg-surface/70 px-5 py-4 text-sm font-semibold backdrop-blur-xl transition-all duration-300 hover:border-accent/50 hover:text-accent active:scale-95"
          >
            <span className="inline-flex items-center justify-center gap-2.5">
              <CameraIcon width={18} height={18} />
              Take Photo
            </span>
          </button>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="sheen min-h-14 flex-1 rounded-2xl bg-gradient-to-br from-accent to-clay px-5 py-4 text-sm font-semibold text-white shadow-glow transition-all duration-300 hover:shadow-float active:scale-95"
          >
            <span className="inline-flex items-center justify-center gap-2.5">
              <UploadIcon width={18} height={18} />
              Choose Photos
            </span>
          </button>
        </div>

        <p className="mx-auto mt-4 max-w-sm text-sm text-muted">
          {recreateFor
            ? 'Take or choose the photo the two of you just made'
            : collection === 'inspiration'
              ? 'Save a picture you would like us to recreate someday'
              : 'Take one now or choose from your gallery'}
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs text-muted/70">
          Photos are resized on your phone first, so uploads stay quick even on a slow connection.
        </p>

        {/* Gallery / Files — unchanged: still multi-select, still drag-and-drop */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Fallback for browsers without live capture: the device camera app */}
        <input
          ref={nativeCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {notice && (
        <p className="animate-reveal rounded-2xl border border-accent/25 bg-accent-soft px-5 py-3.5 text-sm text-accent">
          {notice}
        </p>
      )}

      {items.length > 0 && (
        <>
          {/* Batch details */}
          <div className="card space-y-5 p-6 sm:p-7">
            <h3 className="display text-xl">About these memories</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="tracked mb-2.5 block text-[0.625rem] font-semibold text-muted">
                  {collection === 'inspiration' && !recreateFor ? 'Date added' : 'When did it happen?'}
                </span>
                <input
                  type="date"
                  value={memoryDate}
                  disabled={useFileDates}
                  onChange={(e) => setMemoryDate(e.target.value)}
                  className="w-full rounded-2xl border border-line bg-bg/60 px-4 py-3 text-base transition-all duration-300 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-50 sm:text-sm"
                />
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={useFileDates}
                    onChange={(e) => setUseFileDates(e.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  Use each photo&rsquo;s own date instead
                </label>
              </label>

              <label className="block">
                <span className="tracked mb-2.5 block text-[0.625rem] font-semibold text-muted">
                  Caption for all of them
                </span>
                <input
                  type="text"
                  value={sharedCaption}
                  maxLength={500}
                  onChange={(e) => setSharedCaption(e.target.value)}
                  placeholder="Our first trip together"
                  className="w-full rounded-2xl border border-line bg-bg/60 px-4 py-3 text-base transition-all duration-300 placeholder:text-muted/50 focus:border-accent/50 focus:outline-none focus:ring-4 focus:ring-[var(--ring)] sm:text-sm"
                />
                <span className="mt-2 block text-xs text-muted">
                  You can give any photo its own caption below.
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => setMarkSpecial((v) => !v)}
              aria-pressed={markSpecial}
              className={cn(
                'inline-flex items-center gap-2.5 rounded-full border px-5 py-2.5 text-sm font-medium transition-all duration-300',
                markSpecial
                  ? 'border-gold/50 bg-gold-soft text-gold shadow-soft'
                  : 'border-line text-muted hover:border-gold/40 hover:text-ink',
              )}
            >
              <StarIcon filled={markSpecial} width={16} height={16} />
              Mark as special moments
            </button>
          </div>

          {/* File list */}
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.key}
                className="card animate-reveal flex gap-3.5 p-3.5"
              >
                <div className="relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-line/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                  {item.status === 'done' && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
                      <CheckIcon />
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                  <input
                    type="text"
                    value={item.caption}
                    maxLength={500}
                    disabled={busy}
                    onChange={(e) => patch(item.key, { caption: e.target.value })}
                    placeholder={sharedCaption || 'Add a caption (optional)'}
                    className="w-full rounded-xl border border-line bg-bg/60 px-3.5 py-2.5 text-base transition-all duration-300 placeholder:text-muted/50 focus:border-accent/50 focus:outline-none disabled:opacity-60 sm:text-sm"
                  />

                  {item.status === 'working' && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-accent to-clay transition-[width] duration-500"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}

                  <p className="truncate text-xs text-muted">
                    {item.status === 'failed' ? (
                      <span className="text-danger">{item.error}</span>
                    ) : item.status === 'done' ? (
                      <span className="text-accent">Saved</span>
                    ) : (
                      `${item.file.name} · ${formatBytes(item.file.size)}`
                    )}
                  </p>
                </div>

                {!busy && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    aria-label={`Remove ${item.file.name}`}
                    className="self-start rounded-full p-1.5 text-muted transition hover:text-danger"
                  >
                    <CloseIcon width={16} height={16} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Sticky action bar */}
          <div
            className="glass sticky bottom-24 z-20 flex items-center gap-3 rounded-full border border-line/70 px-5 py-3.5 shadow-float md:bottom-6"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-muted">
              {items.length} photo{items.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
            </p>
            <button
              type="button"
              onClick={upload}
              disabled={busy || readyCount === 0}
              className="sheen shrink-0 rounded-full bg-gradient-to-br from-accent to-clay px-7 py-3 text-sm font-semibold text-white shadow-glow transition-all duration-300 active:scale-95 disabled:opacity-50"
            >
              {busy ? 'Uploading…' : `Upload ${readyCount || ''}`.trim()}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Reads the pixel size of a processed blob. */
function readDimensions(blob: Blob): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    img.src = url;
  });
}

/** The file's own last-modified date as yyyy-MM-dd. */
function fileDate(file: File): string {
  const d = new Date(file.lastModified || Date.now());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
