-- ===========================================================================
--  Our Little World — Our Moments + Recreate Someday
--  Run ONCE in Supabase Dashboard -> SQL Editor -> New query -> Run.
--
--  ADDITIVE ONLY. This adds three columns to public.photos. It creates no
--  table, drops nothing, changes no existing policy, and touches no existing
--  row's data. Safe to re-run.
--
--  Your 25 existing photos keep working exactly as they do now: the new
--  "collection" column defaults to 'moment', so every current memory is
--  already an Our Moment without any backfill.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Which collection a row belongs to
--    'moment'      — something that actually happened (the existing behaviour)
--    'inspiration' — a picture we would like to recreate someday
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists collection text not null default 'moment';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'photos_collection_check'
  ) then
    alter table public.photos
      add constraint photos_collection_check
      check (collection in ('moment', 'inspiration'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Linking an inspiration to the real memory it became
--    Set only on an 'inspiration' row, pointing at the 'moment' row we made
--    when we actually recreated it. ON DELETE SET NULL so deleting the
--    recreated memory never cascades into losing the inspiration.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists recreated_photo_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'photos_recreated_photo_id_fkey'
  ) then
    alter table public.photos
      add constraint photos_recreated_photo_id_fkey
      foreign key (recreated_photo_id) references public.photos (id)
      on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. When we recreated it
--    Kept separately from the link so that "Recreated" survives even if the
--    recreated memory is later deleted.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists recreated_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Indexes for the two collection views
-- ---------------------------------------------------------------------------
create index if not exists photos_collection_idx
  on public.photos (collection, memory_date desc, created_at desc);

create index if not exists photos_inspiration_pending_idx
  on public.photos (created_at desc)
  where collection = 'inspiration' and recreated_at is null;

-- ---------------------------------------------------------------------------
-- 5. No RLS change is needed.
--    The existing policies on public.photos are row-level and cover every
--    column, new ones included. Both collections stay behind is_allowed().
-- ---------------------------------------------------------------------------

-- ===========================================================================
--  PROOF: this must return one row reading
--    25 | 25 | 0 | 3
--  (total photos | already Our Moments | inspirations | new columns present)
--  If you see an error instead, copy the error text.
-- ===========================================================================
select
  (select count(*) from public.photos)                                      as total_photos,
  (select count(*) from public.photos where collection = 'moment')          as our_moments,
  (select count(*) from public.photos where collection = 'inspiration')     as inspirations,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'photos'
       and column_name in ('collection', 'recreated_photo_id', 'recreated_at')) as new_columns;
