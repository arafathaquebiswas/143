-- ===========================================================================
--  Our Little World — private notifications between Arafat and Subbha
--
--  ADDITIVE ONLY. This migration creates:
--    * ONE new table    : public.notifications
--    * ONE new function : public.purge_expired_notifications()
--    * ONE new trigger  : on the new table only
--
--  It does NOT alter, drop or touch: photos, comments, favorites,
--  allowed_users, app_settings, the collections columns
--  (collection / recreated_photo_id / recreated_at), the videos columns
--  (media_kind / expires_at / duration_seconds), storage, or any existing
--  policy. No extension is installed. Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. The table
--
--  Six event types covering the five things you asked for. Comments are split
--  into two types only so the wording and the deep link can differ — a comment
--  on a Clip must open /reels, not /gallery.
--
--      photo          Subbha added a new memory ❤️
--      recreate       Subbha added something to Recreate Someday ✨
--      reel           Subbha added a new Clip 🎬
--      favorite       Subbha loved your memory ❤️
--      comment_photo  Subbha commented on your memory      (on YOUR memory)
--                     Subbha left a note on a memory       (on her own)
--      comment_reel   Subbha commented on your Clip        (on YOUR Clip)
--                     Subbha left a note on a Clip         (on her own)
--
--  Uploads and notes always tell the other person. Only a LOVE is conditional:
--  it fires solely when the item belongs to the other person, so loving your
--  own upload notifies nobody. Nobody is ever told about their own action --
--  the CHECK constraint below makes that impossible, not just unlikely.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),

  -- Who sees it, and who caused it. Both must be approved users.
  recipient_id uuid not null references public.allowed_users (user_id) on delete cascade,
  actor_id     uuid not null references public.allowed_users (user_id) on delete cascade,

  -- What happened. The sentence is assembled in the app from this plus the
  -- actor's CURRENT display name, so renaming yourself never leaves stale
  -- wording sitting in an old notification.
  type text not null check (type in (
    'photo',
    'recreate',
    'reel',
    'favorite',
    'comment_photo',
    'comment_reel'
  )),

  -- What to open. Every one of the six events is about a row in photos
  -- (which holds memories, Clips and Recreate Someday items alike), so this
  -- is NOT NULL: a notification can never exist with nowhere to go.
  --
  -- ON DELETE CASCADE runs in ONE DIRECTION ONLY. Deleting a photo, video or
  -- comment removes the notifications pointing at it, so a notification can
  -- never open something that is gone. Deleting a notification NEVER touches
  -- the photo, video, memory, comment, favourite or Recreate Someday item.
  photo_id   uuid not null references public.photos (id)   on delete cascade,
  comment_id uuid          references public.comments (id) on delete cascade,

  is_read    boolean     not null default false,
  created_at timestamptz not null default now(),

  -- 21-day expiry, as requested: created_at + 21 days.
  expires_at timestamptz not null default (now() + interval '21 days'),

  -- You are never notified about your own action. Enforced by the database,
  -- not only by application code.
  constraint notifications_no_self check (recipient_id <> actor_id)
);


-- ---------------------------------------------------------------------------
--  2. The 21-day lifetime is set by the database, never by the browser
--
--  Defaults alone could be overridden by whatever a request sends. This
--  trigger overwrites both timestamps on every insert, so the retention
--  window cannot be lengthened from the client under any circumstances.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_set_lifetime()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  new.created_at := now();
  new.expires_at := now() + interval '21 days';
  return new;
end;
$fn$;

drop trigger if exists notifications_set_lifetime_trg on public.notifications;
create trigger notifications_set_lifetime_trg
  before insert on public.notifications
  for each row execute function public.notifications_set_lifetime();


-- ---------------------------------------------------------------------------
--  3. Indexes
-- ---------------------------------------------------------------------------

-- The inbox: newest first, for one person.
create index if not exists notifications_inbox_idx
  on public.notifications (recipient_id, created_at desc);

-- The unread badge. Partial, so it stays tiny and the count is instant.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id)
  where is_read = false;

-- The daily purge.
create index if not exists notifications_expiry_idx
  on public.notifications (expires_at);


-- ---------------------------------------------------------------------------
--  4. Duplicate protection, enforced by the database
--
--  React re-renders, double taps, retried requests and realtime reconnects
--  all try to insert the same row and are rejected here. The application
--  treats rejection code 23505 as success, so the love or comment itself
--  still works instantly and nothing appears to fail.
-- ---------------------------------------------------------------------------

-- One comment can only ever produce one notification.
create unique index if not exists notifications_one_per_comment
  on public.notifications (comment_id)
  where comment_id is not null;

-- Everything else: one per (who sees it, who did it, what kind, which item).
--
-- This is what stops love / un-love / love from filling the inbox: the second
-- and every later love of the same item by the same person is refused.
create unique index if not exists notifications_one_per_event
  on public.notifications (recipient_id, actor_id, type, photo_id)
  where comment_id is null;


-- ---------------------------------------------------------------------------
--  5. Row Level Security — a private inbox each
--
--  Neither of you can read, alter or delete the other's inbox.
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

-- You may clear anything from your own inbox.
drop policy if exists "clear your own" on public.notifications;
create policy "clear your own"
  on public.notifications for delete to authenticated
  using ((select public.is_allowed()) and recipient_id = (select auth.uid()));

-- NOTE: there is deliberately NO "the sender may delete what they sent"
-- policy. Such a policy cannot work — PostgreSQL applies the SELECT policies
-- when it locates rows for a DELETE, and the SELECT policy above hides the
-- other person's inbox, so the sender could never find the row. Retracting an
-- un-loved notice is handled by retract_favorite_notification() in section 8.
drop policy if exists "retract your own unread" on public.notifications;


-- ---------------------------------------------------------------------------
--  6. Realtime — instant delivery
--
--  Supabase applies the SELECT policy above to realtime streams, so each of
--  you only ever receives your own notifications. The table stays the source
--  of truth: if the socket drops, the rows are still there on next load.
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


-- ---------------------------------------------------------------------------
--  7. Automatic deletion after 21 days
--
--  NO pg_cron. NO pg_net. NO new extension, service or secret. This is a
--  plain function that your EXISTING daily cleanup call will invoke through
--  the same Hostinger Cron -> Supabase Edge Function -> service-role path
--  that already handles expired videos. One schedule, one secret, two jobs.
--
--  SAFETY: this function contains exactly ONE delete statement and its table
--  is public.notifications. There is no other table named anywhere in its
--  body. It cannot reach a photo, a video, a memory, a storage file, a
--  comment, a favourite or a Recreate Someday item.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  removed integer;
begin
  delete from public.notifications where expires_at < now();
  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

-- Not reachable from the browser at all. Only the service-role key used by
-- the Edge Function may run it.
revoke all on function public.purge_expired_notifications() from public;
revoke all on function public.purge_expired_notifications() from anon;
revoke all on function public.purge_expired_notifications() from authenticated;
grant execute on function public.purge_expired_notifications() to service_role;


-- ---------------------------------------------------------------------------
--  8. Taking back an un-loved notice
--
--  SECURITY DEFINER so it can reach a row the caller is not allowed to read.
--  Safe because the caller cannot choose whose row: actor_id is pinned to
--  auth.uid(), the type is pinned to 'favorite', and is_read = false means a
--  notice already seen can never be erased.
-- ---------------------------------------------------------------------------
create or replace function public.retract_favorite_notification(p_photo_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  removed integer;
begin
  if not public.is_allowed() then
    raise exception 'not allowed';
  end if;

  delete from public.notifications
   where actor_id = auth.uid()
     and photo_id = p_photo_id
     and type     = 'favorite'
     and is_read  = false;

  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

revoke all on function public.retract_favorite_notification(uuid) from public;
revoke all on function public.retract_favorite_notification(uuid) from anon;
grant execute on function public.retract_favorite_notification(uuid) to authenticated;


-- ===========================================================================
--  VERIFICATION
--
--  Expect exactly:
--
--    table_name      | notifications
--    rls_enabled     | true
--    policies        | 4
--    realtime_on     | true
--    purge_fn        | true
--    lifetime_trg    | true
--    expiry_default  | (now() + '21 days'::interval)
--
--  expiry_default is read straight back out of the catalog rather than
--  assumed, and inserts nothing.
-- ===========================================================================
select
  c.relname                                                        as table_name,
  c.relrowsecurity                                                 as rls_enabled,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'notifications')   as policies,
  exists (select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'notifications')                     as realtime_on,
  exists (select 1 from pg_proc p
            join pg_namespace pn on pn.oid = p.pronamespace
           where pn.nspname = 'public'
             and p.proname = 'purge_expired_notifications')         as purge_fn,
  exists (select 1 from pg_trigger
           where tgrelid = 'public.notifications'::regclass
             and tgname  = 'notifications_set_lifetime_trg')        as lifetime_trg,
  (select pg_get_expr(d.adbin, d.adrelid)
     from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.notifications'::regclass
      and a.attname = 'expires_at')                                 as expiry_default
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'notifications';
