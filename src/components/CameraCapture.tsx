'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { CameraIcon, CheckIcon, CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

type Stage = 'starting' | 'live' | 'review' | 'unavailable';

/** What went wrong, in words worth reading. */
function describe(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow it in your browser settings, or choose a photo from your gallery instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. You can still choose a photo from your gallery.';
    case 'NotReadableError':
      return 'The camera is already in use by another app. Close it and try again.';
    default:
      return 'The camera could not be opened here. You can still choose a photo from your gallery.';
  }
}

export default function CameraCapture({
  onUse,
  onCancel,
}: {
  /** Hands the captured photo to the existing upload pipeline. */
  onUse: (file: File) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shotUrlRef = useRef<string | null>(null);

  const [stage, setStage] = useState<Stage>('starting');
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (mode: 'environment' | 'user') => {
      setError(null);
      setStage('starting');
      stop();

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStage('unavailable');
        setError('This browser cannot open the camera directly. Use the camera button below instead.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 2048 },
            height: { ideal: 2048 },
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStage('live');

        // Only offer the flip control when there really is another camera.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setHasMultipleCameras(devices.filter((d) => d.kind === 'videoinput').length > 1);
        } catch {
          /* enumerateDevices can be blocked; the flip button just stays hidden */
        }
      } catch (e) {
        setStage('unavailable');
        setError(describe(e));
      }
    },
    [stop],
  );

  useEffect(() => {
    void start(facing);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the camera and any preview URL when this unmounts.
  useEffect(
    () => () => {
      stop();
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    },
    [stop],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stop();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, stop]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A front camera is previewed mirrored because that is what people expect;
    // save it the same way so the photo matches what they just saw.
    if (facing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.95),
    );
    if (!blob) return;

    const stamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-');
    const file = new File([blob], `photo-${stamp}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    const url = URL.createObjectURL(blob);
    shotUrlRef.current = url;

    setShot({ file, url });
    setStage('review');
    stop();
  };

  const retake = () => {
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    shotUrlRef.current = null;
    setShot(null);
    void start(facing);
  };

  const flip = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    void start(next);
  };

  const cancel = () => {
    stop();
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    onCancel();
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex flex-col bg-[#0b0807]/96 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Take a photo"
    >
      {/* Top bar */}
      <div
        className="flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <span className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur-xl">
          {stage === 'review' ? 'Happy with it?' : 'Take a photo'}
        </span>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 backdrop-blur-xl transition hover:bg-white/15 hover:text-white active:scale-90"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-4">
        {stage === 'unavailable' ? (
          <div className="max-w-sm px-4 text-center">
            <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/10 text-white/70">
              <CameraIcon width={26} height={26} />
            </span>
            <p className="text-[0.9375rem] leading-relaxed text-white/85">{error}</p>
            <button
              type="button"
              onClick={cancel}
              className="mt-7 rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/20"
            >
              Go back
            </button>
          </div>
        ) : stage === 'review' && shot ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={shot.url}
            alt="The photo you just took"
            className="animate-zoom max-h-full max-w-full rounded-2xl object-contain shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={cn(
                'max-h-full max-w-full rounded-2xl object-contain shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] transition-opacity duration-500',
                stage === 'live' ? 'opacity-100' : 'opacity-0',
                facing === 'user' && 'scale-x-[-1]',
              )}
            />
            {stage === 'starting' && (
              <div className="absolute flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
                <p className="text-xs text-white/50">Opening the camera…</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls */}
      {stage !== 'unavailable' && (
        <div
          className="shrink-0 border-t border-white/10 bg-black/30 px-5 py-6 backdrop-blur-2xl"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          {stage === 'review' ? (
            <div className="mx-auto flex max-w-md items-center gap-3">
              <button
                type="button"
                onClick={retake}
                className="min-h-12 flex-1 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-95"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => shot && onUse(shot.file)}
                className="sheen min-h-12 flex-1 rounded-full bg-gradient-to-br from-accent to-clay px-5 py-3 text-sm font-semibold text-white shadow-glow transition hover:shadow-float active:scale-95"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <CheckIcon width={16} height={16} />
                  Use photo
                </span>
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-md items-center justify-center gap-6">
              <div className="w-12">
                {hasMultipleCameras && (
                  <button
                    type="button"
                    onClick={flip}
                    aria-label="Switch camera"
                    title="Switch camera"
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/85 transition hover:bg-white/20 active:scale-90"
                  >
                    <CameraIcon width={19} height={19} />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={capture}
                disabled={stage !== 'live'}
                aria-label="Capture photo"
                className="group relative inline-flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-4 border-white/80 transition active:scale-90 disabled:opacity-40"
              >
                <span className="h-[3.25rem] w-[3.25rem] rounded-full bg-white transition group-hover:bg-white/90" />
              </button>

              <div className="w-12" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
