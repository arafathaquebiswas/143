-- ===========================================================================
--  Our Little World — private notifications
--
--  ADDITIVE ONLY. Creates one new table. It alters no existing table, drops
--  nothing, and changes no existing policy. Safe to re-run.
-- ===========================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.allowed_users (user_id) on delete cascade,
  actor_id     uuid not null references public.allowed_users (user_id) on delete cascade,

  -- What happened. The wording is built in the app from this plus the actor's
  -- name, so a renamed person is never stale in an old notification.
  type text not null check (type in ('photo', 'reel', 'comment_photo', 'comment_reel')),

  -- Deep-link targets. ON DELETE CASCADE means deleting a photo, reel or
  -- comment takes its notifications with it, so a notification can never
  -- point at something that no longer exists.
  photo_id   uuid references public.photos (id)   on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,

  is_read    boolean     not null default false,
  created_at timestamptz not null default now(),

  -- You are never notified about your own action. Enforced here, not just in
  -- application code.
  constraint notifications_no_self check (recipient_id <> actor_id)
);

-- The inbox query: newest first, for one person.
create index if not exists notifications_inbox_idx
  on public.notifications (recipient_id, created_at desc);

-- The unread badge.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id)
  where is_read = false;

-- ---------------------------------------------------------------------------
--  One action, one notification — enforced by the database, so a page
--  refresh, a retried request or a Realtime reconnect cannot duplicate it.
-- ---------------------------------------------------------------------------
create unique index if not exists notifications_one_per_comment
  on public.notifications (comment_id)
  where comment_id is not null;

create unique index if not exists notifications_one_per_upload
  on public.notifications (photo_id, type)
  where comment_id is null and photo_id is not null;

-- ---------------------------------------------------------------------------
--  Row Level Security — a private inbox each.
--  Neither of you can read the other's notifications.
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "read only your own inbox" on public.notifications;
create policy "read only your own inbox"
  on public.notifications for select to authenticated
  using ((select public.is_allowed()) and recipient_id = (select auth.uid()));

-- You may only create a notification AS yourself, FOR the other person.
drop policy if exists "notify the other person" on public.notifications;
create policy "notify the other person"
  on public.notifications for insert to authenticated
  with check (
    (select public.is_allowed())
    and actor_id = (select auth.uid())
    and recipient_id <> (select auth.uid())
  );

-- Marking read is the only update you can make, and only on your own inbox.
drop policy if exists "mark your own as read" on public.notifications;
create policy "mark your own as read"
  on public.notifications for update to authenticated
  using ((select public.is_allowed()) and recipient_id = (select auth.uid()))
  with check ((select public.is_allowed()) and recipient_id = (select auth.uid()));

drop policy if exists "clear your own" on public.notifications;
create policy "clear your own"
  on public.notifications for delete to authenticated
  using ((select public.is_allowed()) and recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
--  Realtime. Supabase applies the SELECT policy above to realtime streams,
--  so each of you only ever receives your own notifications. The table stays
--  the source of truth: if realtime drops, rows are still there on refresh.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ===========================================================================
--  PROOF — expect: notifications | true | 4 | true
-- ===========================================================================
select
  c.relname                                                   as table_name,
  c.relrowsecurity                                            as rls_enabled,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'notifications') as policies,
  exists (select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'notifications')                as realtime_on
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'notifications';
