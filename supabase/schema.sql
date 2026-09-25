-- ===========================================================================
--  Our Little World — database schema
--  Run this ONCE in the Supabase Dashboard -> SQL Editor -> New query -> Run.
--  It is safe to re-run: every statement is idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ALLOW LIST
--    The single source of truth for "who is allowed in this app".
--    Being able to log in is NOT enough — a user must also have a row here.
--    There is deliberately no INSERT policy, so no one can add themselves.
--    You add the two accounts by hand in step 4 of the setup guide.
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_users (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. PHOTOS
--    Only metadata lives here. The image bytes live in Storage; storage_path
--    and thumb_path point at them.
-- ---------------------------------------------------------------------------
create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  uploader_id   uuid not null references public.allowed_users (user_id) on delete restrict,
  storage_path  text not null unique,
  thumb_path    text not null,
  caption       text,
  memory_date   date not null default current_date,
  is_special    boolean not null default false,
  width         integer,
  height        integer,
  size_bytes    bigint,
  original_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists photos_memory_date_idx on public.photos (memory_date desc, created_at desc);
create index if not exists photos_created_at_idx  on public.photos (created_at desc);
create index if not exists photos_special_idx     on public.photos (is_special) where is_special;

-- ---------------------------------------------------------------------------
-- 3. FAVORITES
--    Per-person. Each of you keeps your own hearts, and the Favorites page
--    shows both sets so you can see what the other one loved.
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  photo_id   uuid not null references public.photos (id) on delete cascade,
  user_id    uuid not null references public.allowed_users (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);

create index if not exists favorites_user_idx on public.favorites (user_id);

-- ---------------------------------------------------------------------------
-- 4. APP SETTINGS
--    A tiny key/value table so things like your start date are configurable
--    from the Settings page instead of being hardcoded.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('relationship_start_date', '2024-01-01'),
  ('home_title',              'Our Little World'),
  ('home_quote',              'Distance means so little when someone means so much.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. updated_at TRIGGER
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists photos_touch_updated_at on public.photos;
create trigger photos_touch_updated_at
  before update on public.photos
  for each row execute function public.touch_updated_at();

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. THE GATEKEEPER
--    Every single security policy below funnels through this one function.
--    SECURITY DEFINER lets it read allowed_users without tripping over that
--    table's own RLS; search_path is pinned so it cannot be hijacked.
-- ---------------------------------------------------------------------------
create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users au where au.user_id = auth.uid()
  );
$$;

revoke all on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
--    Turned on everywhere. With RLS on and no matching policy, the default
--    answer is "no" — which is exactly what we want for anon visitors.
--
--    is_allowed() and auth.uid() are wrapped in "(select ...)" on purpose:
--    that makes Postgres evaluate them once per query instead of once per
--    row, which keeps large galleries fast.
-- ---------------------------------------------------------------------------
alter table public.allowed_users enable row level security;
alter table public.photos        enable row level security;
alter table public.favorites     enable row level security;
alter table public.app_settings  enable row level security;

-- --- allowed_users --------------------------------------------------------
drop policy if exists "roster is readable by the two of you" on public.allowed_users;
create policy "roster is readable by the two of you"
  on public.allowed_users for select to authenticated
  using ((select public.is_allowed()));

drop policy if exists "you may rename yourself" on public.allowed_users;
create policy "you may rename yourself"
  on public.allowed_users for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No INSERT and no DELETE policy on purpose:
-- accounts can only be added or removed by you, from the Supabase dashboard.

-- --- photos ---------------------------------------------------------------
drop policy if exists "read every memory" on public.photos;
create policy "read every memory"
  on public.photos for select to authenticated
  using ((select public.is_allowed()));

drop policy if exists "add your own memory" on public.photos;
create policy "add your own memory"
  on public.photos for insert to authenticated
  with check ((select public.is_allowed()) and uploader_id = (select auth.uid()));

drop policy if exists "edit any memory" on public.photos;
create policy "edit any memory"
  on public.photos for update to authenticated
  using ((select public.is_allowed()))
  with check ((select public.is_allowed()));

drop policy if exists "delete any memory" on public.photos;
create policy "delete any memory"
  on public.photos for delete to authenticated
  using ((select public.is_allowed()));

-- --- favorites ------------------------------------------------------------
drop policy if exists "see both sets of hearts" on public.favorites;
create policy "see both sets of hearts"
  on public.favorites for select to authenticated
  using ((select public.is_allowed()));

drop policy if exists "heart a photo yourself" on public.favorites;
create policy "heart a photo yourself"
  on public.favorites for insert to authenticated
  with check ((select public.is_allowed()) and user_id = (select auth.uid()));

drop policy if exists "unheart your own" on public.favorites;
create policy "unheart your own"
  on public.favorites for delete to authenticated
  using ((select public.is_allowed()) and user_id = (select auth.uid()));

-- --- app_settings ---------------------------------------------------------
drop policy if exists "read settings" on public.app_settings;
create policy "read settings"
  on public.app_settings for select to authenticated
  using ((select public.is_allowed()));

drop policy if exists "write settings" on public.app_settings;
create policy "write settings"
  on public.app_settings for insert to authenticated
  with check ((select public.is_allowed()));

drop policy if exists "change settings" on public.app_settings;
create policy "change settings"
  on public.app_settings for update to authenticated
  using ((select public.is_allowed()))
  with check ((select public.is_allowed()));

-- ---------------------------------------------------------------------------
-- 8. PRIVATE PHOTO STORAGE
--    public = false means there is no such thing as a public URL for these
--    files. The app hands out short-lived signed links instead.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memories',
  'memories',
  false,
  26214400, -- 25 MB hard ceiling; the app compresses well below this
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "memories are readable by the two of you" on storage.objects;
create policy "memories are readable by the two of you"
  on storage.objects for select to authenticated
  using (bucket_id = 'memories' and (select public.is_allowed()));

drop policy if exists "upload memories" on storage.objects;
create policy "upload memories"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'memories' and (select public.is_allowed()));

drop policy if exists "replace memories" on storage.objects;
create policy "replace memories"
  on storage.objects for update to authenticated
  using (bucket_id = 'memories' and (select public.is_allowed()))
  with check (bucket_id = 'memories' and (select public.is_allowed()));

drop policy if exists "remove memories" on storage.objects;
create policy "remove memories"
  on storage.objects for delete to authenticated
  using (bucket_id = 'memories' and (select public.is_allowed()));

-- ===========================================================================
--  Done. Nothing in this project is reachable without a session belonging to
--  a user_id that appears in public.allowed_users.
-- ===========================================================================
