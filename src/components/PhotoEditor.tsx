'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CloseIcon, CropIcon, FlipIcon, ResetIcon, RotateLeftIcon, RotateRightIcon } from '@/components/icons';
import { updatePhotoAction, updatePhotoImageAction } from '@/lib/actions';
import { BUCKET, FULL_MAX_EDGE, THUMB_MAX_EDGE } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
import type { Photo } from '@/lib/types';
import { cn } from '@/lib/utils';

const ASPECTS: Array<{ label: string; value: number | null }> = [
  { label: 'Original', value: null }, { label: 'Square', value: 1 }, { label: '4:5', value: 4 / 5 },
  { label: '3:4', value: 3 / 4 }, { label: '16:9', value: 16 / 9 },
];
const COLORS = ['#ef4444', '#3b82f6', '#111111', '#ffffff', '#facc15', '#22c55e'];
const MAX_ZOOM = 6;

type Point = { x: number; y: number };
type Tool = 'move' | 'pen' | 'rect' | 'circle' | 'line' | 'arrow' | 'text' | 'eraser';
type Annotation =
  | { kind: 'pen'; points: Point[]; color: string; size: number }
  | { kind: 'rect' | 'circle' | 'line' | 'arrow'; start: Point; end: Point; color: string; size: number }
  | { kind: 'text'; point: Point; text: string; color: string; size: number };
type Edits = { rotation: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; zoom: number; tx: number; ty: number; aspect: number | null };
const INITIAL: Edits = { rotation: 0, flipH: false, flipV: false, zoom: 1, tx: 0, ty: 0, aspect: null };

export default function PhotoEditor({ photo, onCancel, onSaved }: {
  photo: Photo;
  onCancel: () => void;
  onSaved: (next: { caption: string; memory_date: string; image?: { width: number; height: number; size_bytes: number } }) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Edits>(INITIAL);
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [memoryDate, setMemoryDate] = useState(photo.memory_date);
  const [tool, setTool] = useState<Tool>('move');
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(5);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const markupRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number } | null>(null);
  const draftRef = useRef<Annotation | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (!cancelled) setImage(img); };
    img.onerror = () => { if (!cancelled) setLoadError('That photo could not be opened for editing.'); };
    img.src = photo.url;
    return () => { cancelled = true; };
  }, [photo.url]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const rotated = useMemo(() => {
    if (!image) return { w: 0, h: 0 };
    const quarter = edits.rotation === 90 || edits.rotation === 270;
    return { w: quarter ? image.naturalHeight : image.naturalWidth, h: quarter ? image.naturalWidth : image.naturalHeight };
  }, [image, edits.rotation]);
  const frame = useMemo(() => {
    if (!rotated.w || !stage.width || !stage.height) return { w: 0, h: 0 };
    const ratio = edits.aspect ?? rotated.w / rotated.h;
    let w = stage.width, h = w / ratio;
    if (h > stage.height) { h = stage.height; w = h * ratio; }
    return { w, h };
  }, [rotated, stage, edits.aspect]);
  const displayScale = useMemo(() => !rotated.w || !frame.w ? 1 : Math.max(frame.w / rotated.w, frame.h / rotated.h) * edits.zoom, [rotated, frame, edits.zoom]);
  const clampPan = useCallback((tx: number, ty: number, scale: number) => {
    const maxX = Math.max(0, (rotated.w * scale - frame.w) / 2);
    const maxY = Math.max(0, (rotated.h * scale - frame.h) / 2);
    return { tx: Math.min(maxX, Math.max(-maxX, tx)), ty: Math.min(maxY, Math.max(-maxY, ty)) };
  }, [rotated, frame]);
  useEffect(() => setEdits((current) => {
    const next = clampPan(current.tx, current.ty, displayScale);
    return next.tx === current.tx && next.ty === current.ty ? current : { ...current, ...next };
  }), [clampPan, displayScale]);

  const transformed = edits.rotation !== 0 || edits.flipH || edits.flipV || edits.zoom !== 1 || edits.tx !== 0 || edits.ty !== 0 || edits.aspect !== null;
  const imageChanged = transformed || annotations.length > 0;
  const detailsChanged = caption.trim() !== (photo.caption ?? '') || memoryDate !== photo.memory_date;

  const onMoveDown = (event: React.PointerEvent) => {
    if (tool !== 'move') return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: edits.zoom };
    }
  };
  const onMove = (event: React.PointerEvent) => {
    if (tool !== 'move') return;
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const zoom = Math.min(MAX_ZOOM, Math.max(1, (gesture.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / (gesture.current.dist || 1)));
      setEdits((current) => ({ ...current, zoom }));
      return;
    }
    setEdits((current) => ({ ...current, ...clampPan(current.tx + event.clientX - previous.x, current.ty + event.clientY - previous.y, displayScale) }));
  };
  const endMove = (event: React.PointerEvent) => {
    if (tool !== 'move') return;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };

  const pushAnnotations = (next: Annotation[]) => {
    setUndoStack((history) => [...history, annotations]);
    setRedoStack([]);
    setAnnotations(next);
  };
  const undo = () => setUndoStack((history) => {
    const previous = history.at(-1);
    if (!previous) return history;
    setRedoStack((future) => [...future, annotations]);
    setAnnotations(previous);
    return history.slice(0, -1);
  });
  const redo = () => setRedoStack((future) => {
    const next = future.at(-1);
    if (!next) return future;
    setUndoStack((history) => [...history, annotations]);
    setAnnotations(next);
    return future.slice(0, -1);
  });
  const reset = () => {
    setEdits(INITIAL); setCaption(photo.caption ?? ''); setMemoryDate(photo.memory_date);
    setAnnotations([]); setUndoStack([]); setRedoStack([]); setDraft(null); draftRef.current = null;
  };
  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) };
  };
  const eraseAt = (point: Point) => {
    const next = annotations.filter((annotation) => !annotationNear(annotation, point, brush / Math.max(frame.w, 1)));
    if (next.length !== annotations.length) pushAnnotations(next);
  };
  const onMarkupDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (saving || tool === 'move') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointAt(event);
    if (tool === 'eraser') { eraseAt(point); return; }
    if (tool === 'text') {
      const text = window.prompt('Text to add');
      if (text?.trim()) pushAnnotations([...annotations, { kind: 'text', point, text: text.trim(), color, size: brush * 4 / Math.max(frame.w, 1) }]);
      return;
    }
    const next: Annotation = tool === 'pen'
      ? { kind: 'pen', points: [point], color, size: brush / Math.max(frame.w, 1) }
      : { kind: tool, start: point, end: point, color, size: brush / Math.max(frame.w, 1) };
    draftRef.current = next;
    setDraft(next);
  };
  const onMarkupMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = draftRef.current;
    if (!current) {
      if (tool === 'eraser' && event.buttons) eraseAt(pointAt(event));
      return;
    }
    const point = pointAt(event);
    if (current.kind === 'text') return;
    const next: Annotation = current.kind === 'pen'
      ? { ...current, points: [...current.points, point] }
      : { ...current, end: point };
    draftRef.current = next;
    setDraft(next);
  };
  const onMarkupUp = () => {
    const current = draftRef.current;
    if (current) pushAnnotations([...annotations, current]);
    draftRef.current = null;
    setDraft(null);
  };

  useEffect(() => {
    const canvas = markupRef.current;
    if (!canvas || !frame.w || !frame.h) return;
    const density = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(frame.w * density));
    canvas.height = Math.max(1, Math.round(frame.h * density));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, frame.w, frame.h);
    drawAnnotations(context, draft ? [...annotations, draft] : annotations, frame.w, frame.h);
  }, [annotations, draft, frame]);

  const rotate = (direction: -1 | 1) => setEdits((current) => ({ ...current, rotation: (((current.rotation + direction * 90) % 360) + 360) % 360 as Edits['rotation'], tx: 0, ty: 0 }));
  const buildBaseCanvas = useCallback(() => {
    if (!image) return null;
    const canvas = document.createElement('canvas');
    canvas.width = rotated.w; canvas.height = rotated.h;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingQuality = 'high';
    context.translate(rotated.w / 2, rotated.h / 2);
    context.rotate((edits.rotation * Math.PI) / 180);
    context.scale(edits.flipH ? -1 : 1, edits.flipV ? -1 : 1);
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    return canvas;
  }, [image, rotated, edits.rotation, edits.flipH, edits.flipV]);
  const save = async () => {
    if ((imageChanged && !image) || (!imageChanged && !detailsChanged)) return;
    setSaving(true); setSaveError(null);
    try {
      let editedImage: { width: number; height: number; size_bytes: number } | undefined;
      if (imageChanged) {
        const base = buildBaseCanvas();
        if (!base) throw new Error('Could not prepare the image.');
        const sw = frame.w / displayScale, sh = frame.h / displayScale;
        const sx = (rotated.w - sw) / 2 - edits.tx / displayScale;
        const sy = (rotated.h - sh) / 2 - edits.ty / displayScale;
        const full = renderCrop(base, { sx, sy, sw, sh }, FULL_MAX_EDGE);
        const thumb = renderCrop(base, { sx, sy, sw, sh }, THUMB_MAX_EDGE);
        drawAnnotations(full.getContext('2d')!, annotations, full.width, full.height);
        drawAnnotations(thumb.getContext('2d')!, annotations, thumb.width, thumb.height);
        const [fullBlob, thumbBlob] = await Promise.all([toBlob(full, 0.88), toBlob(thumb, 0.75)]);
        const supabase = createClient();
        const fullUpload = await supabase.storage.from(BUCKET).upload(photo.storage_path, fullBlob, { contentType: 'image/jpeg', cacheControl: 'no-cache', upsert: true });
        if (fullUpload.error) throw new Error(fullUpload.error.message);
        const thumbUpload = await supabase.storage.from(BUCKET).upload(photo.thumb_path, thumbBlob, { contentType: 'image/jpeg', cacheControl: 'no-cache', upsert: true });
        if (thumbUpload.error) throw new Error(thumbUpload.error.message);
        editedImage = { width: full.width, height: full.height, size_bytes: fullBlob.size };
      }
      const details = { caption, memory_date: memoryDate };
      const result = editedImage ? await updatePhotoImageAction(photo.id, editedImage, details) : await updatePhotoAction(photo.id, details);
      if (!result.ok) throw new Error(result.error);
      onSaved({ ...details, image: editedImage });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the edit.');
      setSaving(false);
    }
  };

  const button = 'inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-xs font-medium text-white/80 transition hover:bg-white/15 hover:text-white active:scale-95 disabled:opacity-40';
  const iconButton = `${button} w-10 px-0`;
  const tools: Array<[Tool, string]> = [['move', 'Move'], ['pen', 'Pen'], ['rect', 'Box'], ['circle', 'Circle'], ['line', 'Line'], ['arrow', 'Arrow'], ['text', 'Text'], ['eraser', 'Erase']];

  return (
    <div className="animate-fade fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-xl">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur-xl"><CropIcon width={14} height={14} /> Edit photo</span>
        <button type="button" onClick={onCancel} disabled={saving} aria-label="Close the editor" className={cn(iconButton, 'ml-auto')}><CloseIcon width={18} height={18} /></button>
      </div>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-4 sm:px-10">
        {loadError ? <p className="max-w-xs text-center text-sm text-white/70">{loadError}</p> : !image ? <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-white/70" /> : (
          <div className="relative touch-none select-none overflow-hidden rounded-2xl shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]" style={{ width: frame.w, height: frame.h, cursor: tool === 'move' && edits.zoom > 1 ? 'grab' : 'crosshair' }} onPointerDown={onMoveDown} onPointerMove={onMove} onPointerUp={endMove} onPointerCancel={endMove} onWheel={(event) => { if (tool === 'move') setEdits((current) => ({ ...current, zoom: Math.min(MAX_ZOOM, Math.max(1, current.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))) })); }}>
            <div className="absolute left-1/2 top-1/2" style={{ width: rotated.w, height: rotated.h, transform: `translate(-50%, -50%) translate(${edits.tx}px, ${edits.ty}px) scale(${displayScale})`, transformOrigin: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" draggable={false} className="absolute left-1/2 top-1/2 max-w-none" style={{ width: image.naturalWidth, height: image.naturalHeight, transform: `translate(-50%, -50%) rotate(${edits.rotation}deg) scale(${edits.flipH ? -1 : 1}, ${edits.flipV ? -1 : 1})` }} />
            </div>
            <canvas ref={markupRef} className="absolute inset-0 h-full w-full touch-none" style={{ pointerEvents: tool === 'move' ? 'none' : 'auto' }} onPointerDown={onMarkupDown} onPointerMove={onMarkupMove} onPointerUp={onMarkupUp} onPointerCancel={onMarkupUp} />
            <div aria-hidden className="pointer-events-none absolute inset-0"><div className="absolute inset-0 rounded-2xl border border-white/40" />{[33.333, 66.666].map((p) => <div key={`v${p}`} className="absolute top-0 h-full w-px bg-white/15" style={{ left: `${p}%` }} />)}{[33.333, 66.666].map((p) => <div key={`h${p}`} className="absolute left-0 h-px w-full bg-white/15" style={{ top: `${p}%` }} />)}</div>
          </div>
        )}
      </div>
      <div className="shrink-0 space-y-3 border-t border-white/10 bg-black/40 px-4 py-3 backdrop-blur-2xl sm:px-8" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto w-full max-w-2xl space-y-3">
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">{tools.map(([value, label]) => <button key={value} type="button" disabled={saving || !image} onClick={() => setTool(value)} className={cn(button, tool === value && 'border-white/60 bg-white text-black hover:bg-white')}>{label}</button>)}<button type="button" disabled={saving || undoStack.length === 0} onClick={undo} className={button}>Undo</button><button type="button" disabled={saving || redoStack.length === 0} onClick={redo} className={button}>Redo</button></div>
          <div className="flex items-center gap-3"><span className="tracked shrink-0 text-[0.625rem] font-semibold text-white/45">Color</span>{COLORS.map((value) => <button key={value} type="button" aria-label={`Use ${value}`} onClick={() => setColor(value)} className={cn('h-7 w-7 shrink-0 rounded-full border-2 transition active:scale-90', color === value ? 'border-white scale-110' : 'border-white/25')} style={{ backgroundColor: value }} />)}<input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Choose custom color" className="h-7 w-7 shrink-0 cursor-pointer rounded-full bg-transparent" /></div>
          <label className="flex items-center gap-3"><span className="tracked shrink-0 text-[0.625rem] font-semibold text-white/45">Brush</span><input type="range" min={2} max={24} value={brush} onChange={(event) => setBrush(Number(event.target.value))} className="h-1.5 w-full accent-white" /><span className="w-7 text-right text-xs text-white/55">{brush}</span></label>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">{ASPECTS.map((aspect) => <button key={aspect.label} type="button" disabled={saving || !image} onClick={() => setEdits((current) => ({ ...current, aspect: aspect.value, tx: 0, ty: 0 }))} className={cn(button, edits.aspect === aspect.value && 'border-white/60 bg-white text-black hover:bg-white')}>{aspect.label}</button>)}<button type="button" disabled={saving || !image} onClick={() => rotate(-1)} className={iconButton} aria-label="Rotate left"><RotateLeftIcon width={18} height={18} /></button><button type="button" disabled={saving || !image} onClick={() => rotate(1)} className={iconButton} aria-label="Rotate right"><RotateRightIcon width={18} height={18} /></button><button type="button" disabled={saving || !image} onClick={() => setEdits((current) => ({ ...current, flipH: !current.flipH }))} className={cn(iconButton, edits.flipH && 'border-white/60 bg-white text-black')} aria-label="Flip horizontally"><FlipIcon width={18} height={18} /></button><button type="button" disabled={saving || (!imageChanged && !detailsChanged)} onClick={reset} className={iconButton} aria-label="Reset"><ResetIcon width={18} height={18} /></button></div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} placeholder="What was happening here?" disabled={saving} aria-label="Caption" className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-2 text-base text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none disabled:opacity-40 sm:text-sm" /><input type="date" value={memoryDate} onChange={(event) => setMemoryDate(event.target.value)} disabled={saving} aria-label="Memory date" className="rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-2 text-base text-white [color-scheme:dark] focus:border-white/35 focus:outline-none disabled:opacity-40 sm:text-sm" /></div>
          {saveError && <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/15 px-4 py-2 text-center text-xs text-white">{saveError}</p>}
          <div className="flex items-center gap-3"><p className="min-w-0 flex-1 truncate text-xs text-white/40">{tool === 'move' ? 'Drag to reposition · pinch to zoom' : tool === 'text' ? 'Tap the photo to place text' : 'Draw directly on the photo'}</p><button type="button" onClick={onCancel} disabled={saving} className="shrink-0 rounded-full px-5 py-2.5 text-sm text-white/60 transition hover:text-white disabled:opacity-40">Cancel</button><button type="button" onClick={save} disabled={saving || (imageChanged && !image) || (!imageChanged && !detailsChanged)} className="sheen shrink-0 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40">{saving ? 'Saving…' : 'Save changes'}</button></div>
        </div>
      </div>
    </div>
  );
}

function drawAnnotations(context: CanvasRenderingContext2D, annotations: Annotation[], width: number, height: number) {
  for (const annotation of annotations) {
    const stroke = Math.max(1, annotation.size * width);
    context.save(); context.strokeStyle = annotation.color; context.fillStyle = annotation.color; context.lineWidth = stroke; context.lineCap = 'round'; context.lineJoin = 'round';
    if (annotation.kind === 'pen') {
      const points = annotation.points;
      context.beginPath(); context.moveTo(points[0].x * width, points[0].y * height);
      for (const point of points.slice(1)) context.lineTo(point.x * width, point.y * height);
      if (points.length === 1) context.lineTo(points[0].x * width + 0.01, points[0].y * height + 0.01);
      context.stroke();
    } else if (annotation.kind === 'text') {
      context.font = `${Math.max(12, annotation.size * width)}px ui-sans-serif, system-ui, sans-serif`; context.textBaseline = 'top';
      context.fillText(annotation.text, annotation.point.x * width, annotation.point.y * height);
    } else {
      const x1 = annotation.start.x * width, y1 = annotation.start.y * height, x2 = annotation.end.x * width, y2 = annotation.end.y * height;
      context.beginPath();
      if (annotation.kind === 'rect') context.rect(x1, y1, x2 - x1, y2 - y1);
      if (annotation.kind === 'circle') context.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      if (annotation.kind === 'line' || annotation.kind === 'arrow') { context.moveTo(x1, y1); context.lineTo(x2, y2); }
      context.stroke();
      if (annotation.kind === 'arrow') {
        const angle = Math.atan2(y2 - y1, x2 - x1), head = Math.max(8, stroke * 3);
        context.beginPath(); context.moveTo(x2, y2); context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6)); context.moveTo(x2, y2); context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6)); context.stroke();
      }
    }
    context.restore();
  }
}
function annotationNear(annotation: Annotation, point: Point, radius: number) {
  const points = annotation.kind === 'pen' ? annotation.points : annotation.kind === 'text' ? [annotation.point] : [annotation.start, annotation.end];
  return points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < Math.max(radius * 2, 0.025));
}
function renderCrop(source: HTMLCanvasElement, rect: { sx: number; sy: number; sw: number; sh: number }, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(rect.sw, rect.sh));
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(rect.sw * scale)); output.height = Math.max(1, Math.round(rect.sh * scale));
  const context = output.getContext('2d');
  if (context) { context.imageSmoothingQuality = 'high'; context.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, output.width, output.height); }
  return output;
}
function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), 'image/jpeg', quality));
}
