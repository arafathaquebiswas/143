'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { CameraIcon, CheckIcon, CloseIcon } from '@/components/icons';
import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, formatDuration } from '@/lib/video';
import { cn } from '@/lib/utils';

type Stage = 'starting' | 'ready' | 'recording' | 'review' | 'unavailable';

/** The first MIME type this browser can actually record. */
function pickMimeType(): string | null {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

export default function VideoRecorder({
  onUse,
  onCancel,
}: {
  onUse: (file: File) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shotUrlRef = useRef<string | null>(null);

  const [stage, setStage] = useState<Stage>('starting');
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ file: File; url: string; seconds: number } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (mode: 'environment' | 'user') => {
      setError(null);
      setStage('starting');
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setStage('unavailable');
        setError('This browser cannot record video. Use Gallery to pick one instead.');
        return;
      }
      if (!pickMimeType()) {
        setStage('unavailable');
        setError('This browser cannot record a video we can both play. Use Gallery instead.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStage('ready');
      } catch (e) {
        const name = (e as { name?: string })?.name ?? '';
        setStage('unavailable');
        setError(
          name === 'NotAllowedError'
            ? 'Camera or microphone access was blocked. Allow it, or use Gallery instead.'
            : name === 'NotFoundError'
              ? 'No camera was found. Use Gallery to pick a video instead.'
              : 'The camera could not be opened here. Use Gallery instead.',
        );
      }
    },
    [stopStream],
  );

  useEffect(() => {
    void start(facing);
    return () => {
      stopStream();
      if (tickRef.current) clearInterval(tickRef.current);
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  const beginRecording = () => {
    const stream = streamRef.current;
    const mimeType = pickMimeType();
    if (!stream || !mimeType) return;

    chunksRef.current = [];
    // ~2 Mbps keeps 45 s comfortably under the 12 MB ceiling.
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const seconds = Math.min(elapsedRef.current, MAX_VIDEO_SECONDS);

      // A WebM recording cannot be played by Safari, so it is not offered.
      if (!mimeType.startsWith('video/mp4')) {
        setStage('unavailable');
        setError(
          'This browser records in a format the other phone cannot play. ' +
            'Record with the phone camera app instead and add it from Gallery.',
        );
        stopStream();
        return;
      }

      if (blob.size > MAX_VIDEO_BYTES) {
        setStage('ready');
        setError(`That came to ${(blob.size / 1024 / 1024).toFixed(1)} MB. Try a shorter clip.`);
        return;
      }

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const file = new File([blob], `reel-${stamp}.mp4`, { type: 'video/mp4' });
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
      const url = URL.createObjectURL(blob);
      shotUrlRef.current = url;
      setClip({ file, url, seconds });
      setStage('review');
      stopStream();
    };

    recorder.start(250);
    setElapsed(0);
    elapsedRef.current = 0;
    setStage('recording');

    tickRef.current = setInterval(() => {
      elapsedRef.current += 0.1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= MAX_VIDEO_SECONDS) stopRecording();
    }, 100);
  };

  const elapsedRef = useRef(0);

  const retake = () => {
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    shotUrlRef.current = null;
    setClip(null);
    setError(null);
    void start(facing);
  };

  const cancel = () => {
    stopRecording();
    stopStream();
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
    onCancel();
  };

  const remaining = Math.max(0, MAX_VIDEO_SECONDS - elapsed);

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex flex-col bg-[#0b0807]/96 backdrop-blur-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Record a Little Clip"
    >
      <div
        className="flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <span
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur-xl',
            stage === 'recording'
              ? 'border-danger/40 bg-danger/20 text-white'
              : 'border-white/10 bg-white/5 text-white/80',
          )}
        >
          {stage === 'recording'
            ? `● ${formatDuration(elapsed)} · ${Math.ceil(remaining)}s left`
            : stage === 'review'
              ? 'Happy with it?'
              : `Up to ${MAX_VIDEO_SECONDS}s`}
        </span>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 backdrop-blur-xl transition hover:bg-white/15 active:scale-90"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>

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
        ) : stage === 'review' && clip ? (
          <video
            src={clip.url}
            controls
            playsInline
            preload="metadata"
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
                'max-h-full max-w-full rounded-2xl object-contain transition-opacity duration-500',
                stage === 'starting' ? 'opacity-0' : 'opacity-100',
                facing === 'user' && 'scale-x-[-1]',
              )}
            />
            {stage === 'starting' && (
              <div className="absolute h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
            )}
          </>
        )}
      </div>

      {stage !== 'unavailable' && (
        <div
          className="shrink-0 border-t border-white/10 bg-black/30 px-5 py-6 backdrop-blur-2xl"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
        >
          {error && stage !== 'review' && (
            <p className="mx-auto mb-4 max-w-md text-center text-xs text-danger">{error}</p>
          )}

          {stage === 'review' && clip ? (
            <div className="mx-auto flex max-w-md items-center gap-3">
              <button
                type="button"
                onClick={retake}
                className="min-h-12 flex-1 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => onUse(clip.file)}
                className="sheen min-h-12 flex-1 rounded-full bg-gradient-to-br from-accent to-clay px-5 py-3 text-sm font-semibold text-white shadow-glow transition"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <CheckIcon width={16} height={16} />
                  Use this
                </span>
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-md items-center justify-center gap-6">
              <div className="w-12">
                {stage === 'ready' && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = facing === 'environment' ? 'user' : 'environment';
                      setFacing(next);
                      void start(next);
                    }}
                    aria-label="Switch camera"
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/85 transition hover:bg-white/20 active:scale-90"
                  >
                    <CameraIcon width={19} height={19} />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={stage === 'recording' ? stopRecording : beginRecording}
                disabled={stage === 'starting'}
                aria-label={stage === 'recording' ? 'Stop recording' : 'Start recording'}
                className="group relative inline-flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-4 border-white/80 transition active:scale-90 disabled:opacity-40"
              >
                <span
                  className={cn(
                    'bg-danger transition-all duration-300',
                    stage === 'recording' ? 'h-7 w-7 rounded-md' : 'h-[3.25rem] w-[3.25rem] rounded-full',
                  )}
                />
              </button>

              <div className="w-12" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
