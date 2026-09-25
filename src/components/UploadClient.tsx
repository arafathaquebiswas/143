'use client';

import imageCompression from 'browser-image-compression';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { CameraIcon, CheckIcon, CloseIcon, StarIcon, UploadIcon } from '@/components/icons';
import { createPhotosAction, type NewPhotoInput } from '@/lib/actions';
import {
  ACCEPTED_IMAGE_TYPES,
  BUCKET,
  FULL_MAX_EDGE,
  FULL_MAX_MB,
  THUMB_MAX_EDGE,
  THUMB_MAX_MB,
} from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
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

export default function UploadClient({ userId }: { userId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [memoryDate, setMemoryDate] = useState(todayISO());
  const [useFileDates, setUseFileDates] = useState(false);
  const [sharedCaption, setSharedCaption] = useState('');
  const [markSpecial, setMarkSpecial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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
      const result = await createPhotosAction(saved);
      if (!result.ok) {
        setNotice(`Photos uploaded but could not be saved: ${result.error}`);
        setBusy(false);
        return;
      }
      router.refresh();
      router.push('/gallery');
      return;
    }

    setNotice('Nothing could be uploaded. Check the errors below and try again.');
    setBusy(false);
  };

  const readyCount = items.filter((i) => i.status === 'ready' || i.status === 'failed').length;
  const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0);

  return (
    <div className="space-y-6">
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
          'rounded-[var(--radius-card)] border-2 border-dashed bg-surface/60 px-6 py-10 text-center transition-colors',
          dragging ? 'border-accent bg-accent-soft/50' : 'border-line-strong',
        )}
      >
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          <CameraIcon width={24} height={24} />
        </span>
        <h2 className="font-display text-xl">Add to our album</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
          Pick as many photos as you like. They are resized on your phone first, so uploads stay
          quick even on a slow connection.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-contrast shadow-soft transition hover:bg-accent-hover active:scale-95"
        >
          <UploadIcon width={17} height={17} />
          Choose photos
        </button>
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
      </div>

      {notice && (
        <p className="rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-accent">
          {notice}
        </p>
      )}

      {items.length > 0 && (
        <>
          {/* Batch details */}
          <div className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-soft">
            <h3 className="font-display text-lg">About these memories</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                  When did it happen?
                </span>
                <input
                  type="date"
                  value={memoryDate}
                  disabled={useFileDates}
                  onChange={(e) => setMemoryDate(e.target.value)}
                  className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-base sm:text-sm disabled:opacity-50"
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
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
                  Caption for all of them
                </span>
                <input
                  type="text"
                  value={sharedCaption}
                  maxLength={500}
                  onChange={(e) => setSharedCaption(e.target.value)}
                  placeholder="Our first trip together"
                  className="w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-base sm:text-sm placeholder:text-muted/70"
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
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition',
                markSpecial
                  ? 'border-gold bg-gold-soft text-gold'
                  : 'border-line text-muted hover:text-ink',
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
                className="animate-rise flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-soft"
              >
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-2">
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
                    className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-base sm:text-sm placeholder:text-muted/70 disabled:opacity-60"
                  />

                  {item.status === 'working' && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300"
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
            className="sticky bottom-20 z-20 flex items-center gap-3 rounded-full border border-line bg-surface/95 px-4 py-3 shadow-float backdrop-blur-xl md:bottom-6"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-muted">
              {items.length} photo{items.length === 1 ? '' : 's'} · {formatBytes(totalBytes)}
            </p>
            <button
              type="button"
              onClick={upload}
              disabled={busy || readyCount === 0}
              className="shrink-0 rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:scale-95 disabled:opacity-50"
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
