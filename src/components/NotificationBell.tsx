'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { BellIcon, CloseIcon } from '@/components/icons';
import {
  type AppNotification,
  getUnreadCountAction,
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/actions';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/** "just now", "4m", "3h", "2d", then a date. */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function describe(n: AppNotification): string {
  switch (n.type) {
    case 'photo':
      return `${n.actorName} added a new memory ❤️`;
    case 'recreate':
      return `${n.actorName} added something to Recreate Someday ✨`;
    case 'reel':
      return `${n.actorName} added a new Clip 🎬`;
    case 'favorite':
      return `${n.actorName} loved your memory ❤️`;
    // A note on their own memory is still worth telling you about, but calling
    // it "your memory" would be a lie, so the sentence follows the owner.
    case 'comment_photo':
      return n.targetIsMine
        ? `${n.actorName} commented on your memory`
        : `${n.actorName} left a note on a memory`;
    case 'comment_reel':
      return n.targetIsMine
        ? `${n.actorName} commented on your Clip`
        : `${n.actorName} left a note on a Clip`;
  }
}

/** Where clicking it should take you — the exact item, never a list page. */
function linkFor(n: AppNotification): string {
  const notes = n.commentId ? '&notes=1' : '';
  if (n.type === 'recreate') return `/recreate?item=${n.photoId}`;
  if (n.mediaKind === 'video' || n.type === 'reel' || n.type === 'comment_reel') {
    return `/reels?clip=${n.photoId}${notes}`;
  }
  return `/gallery?photo=${n.photoId}${notes}`;
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [, startMutation] = useTransition();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Read inside the realtime callback so opening the panel does not tear down
  // and rebuild the subscription.
  const openRef = useRef(false);

  const refresh = useCallback(async () => {
    const r = await listNotificationsAction(20, 0);
    setItems(r.items);
    setUnread(r.unread);
    setAvailable(r.available);
  }, []);

  /**
   * Just the number. The bell sits in the navbar, so this runs on every page
   * load and must stay one HEAD count — no roster, no photo rows, no signed
   * thumbnail URLs. Those are only worth fetching once you open the panel.
   */
  const refreshCount = useCallback(async () => {
    const r = await getUnreadCountAction();
    setUnread(r.unread);
    setAvailable(r.available);
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  // Keeps the ref above in step with the state, wherever the panel is closed
  // from — the button, a click outside, Escape, or following a link.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Realtime is for instant delivery only; the table remains the truth, so a
  // dropped connection just means you see it on the next load.
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel('notifications-inbox')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
          // While the panel is shut, a new arrival only needs to move the
          // badge. The list itself is refetched when you open it.
          void (openRef.current ? refresh() : refreshCount());
        })
        .subscribe();
    } catch {
      /* realtime unavailable — polling on navigation still works */
    }
    return () => {
      try {
        channel?.unsubscribe();
      } catch {
        /* ignore */
      }
    };
  }, [refresh, refreshCount]);

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  };

  const openItem = (n: AppNotification) => {
    setOpen(false);
    if (!n.isRead) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      startMutation(() => void markNotificationReadAction(n.id));
    }
    router.push(linkFor(n));
  };

  const markAll = () => {
    setItems((cur) => cur.map((x) => ({ ...x, isRead: true })));
    setUnread(0);
    startMutation(() => void markAllNotificationsReadAction());
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-line/70 bg-surface/60 text-muted backdrop-blur-xl transition-all duration-300 hover:border-accent/40 hover:text-accent active:scale-90"
      >
        <BellIcon width={17} height={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-gradient-to-br from-accent to-clay px-1 text-[0.625rem] font-bold leading-none text-white shadow-soft">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="card absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0 shadow-float"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <p className="display text-base">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="ml-auto rounded-full px-2.5 py-1.5 text-[0.6875rem] font-medium text-muted transition hover:text-accent"
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:text-ink',
                unread > 0 ? '' : 'ml-auto',
              )}
            >
              <CloseIcon width={14} height={14} />
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {!available ? (
              <p className="px-4 py-8 text-center text-sm leading-relaxed text-muted">
                Notifications are not set up yet.
              </p>
            ) : loading && items.length === 0 ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-14 rounded-xl" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing new yet.</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2/60',
                        !n.isRead && 'bg-accent-soft/40',
                      )}
                    >
                      {n.thumbUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={n.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="h-11 w-11 shrink-0 rounded-xl bg-surface-2 object-cover"
                        />
                      ) : (
                        <span className="h-11 w-11 shrink-0 rounded-xl bg-surface-2" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8125rem] leading-snug text-ink">
                          {describe(n)}
                        </span>
                        <span className="mt-0.5 block text-[0.6875rem] text-muted">
                          {ago(n.createdAt)}
                        </span>
                      </span>
                      {!n.isRead && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
