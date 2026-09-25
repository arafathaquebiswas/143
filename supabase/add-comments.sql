-- ===========================================================================
--  Our Little World — add private comments
--  Run ONCE in Supabase Dashboard -> SQL Editor -> New query -> Run.
--  Additive only: this touches no existing table, column or policy.
--  Safe to re-run.
-- ===========================================================================

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  author_id  uuid not null references public.allowed_users (user_id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reading a photo's comments in order is the only access pattern.
create index if not exists comments_photo_idx on public.comments (photo_id, created_at);

drop trigger if exists comments_touch_updated_at on public.comments;
create trigger comments_touch_updated_at
  before update on public.comments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — same gate as everything else: public.is_allowed()
-- ---------------------------------------------------------------------------
alter table public.comments enable row level security;

-- Both of you read every comment.
drop policy if exists "read every comment" on public.comments;
create policy "read every comment"
  on public.comments for select to authenticated
  using ((select public.is_allowed()));

-- You can only post as yourself.
drop policy if exists "post your own comment" on public.comments;
create policy "post your own comment"
  on public.comments for insert to authenticated
  with check ((select public.is_allowed()) and author_id = (select auth.uid()));

-- You can only edit your own words.
drop policy if exists "edit your own comment" on public.comments;
create policy "edit your own comment"
  on public.comments for update to authenticated
  using ((select public.is_allowed()) and author_id = (select auth.uid()))
  with check ((select public.is_allowed()) and author_id = (select auth.uid()));

-- You can only remove your own words. Deliberate: either of you can delete a
-- photo, but neither can delete what the other person wrote.
drop policy if exists "remove your own comment" on public.comments;
create policy "remove your own comment"
  on public.comments for delete to authenticated
  using ((select public.is_allowed()) and author_id = (select auth.uid()));

-- ===========================================================================
--  Done. A signed-out visitor, or a logged-in account that is not on the
--  allow list, reads and writes nothing here.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PROOF: this must return one row reading  comments | 4 | t
-- If you see it, the feature is ready. If you see an error instead, copy the
-- error text — that is what Claude needs.
-- ---------------------------------------------------------------------------
select
  c.relname                                        as table_name,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'comments') as policies,
  c.relrowsecurity                                 as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'comments';
