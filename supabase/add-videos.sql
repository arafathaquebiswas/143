-- ===========================================================================
--  Our Little World — video memories (schema only)
--
--  ADDITIVE ONLY. Adds three columns to public.photos and widens the bucket's
--  accepted file types. It creates no table, drops nothing, changes no
--  existing policy, and modifies no existing row's data.
--
--  This migration is INERT on its own: no application code reads these
--  columns yet, so running it changes nothing you can see. It is safe to run
--  before deciding whether to go ahead with videos.
--
--  Safe to re-run.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. What kind of media a row is
--    Defaults to 'photo', so all 25 existing memories are already photos with
--    no backfill. The expiry job keys off this column and will never match
--    a photo.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists media_kind text not null default 'photo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_media_kind_check') then
    alter table public.photos
      add constraint photos_media_kind_check check (media_kind in ('photo', 'video'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. When a video expires
--    Null for photos, and the cleanup requires it to be non-null, so a photo
--    can never be selected for deletion even if this column were mis-set.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists expires_at timestamptz;

-- A photo must never carry an expiry, and a video must always have one.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_expiry_only_for_video') then
    alter table public.photos
      add constraint photos_expiry_only_for_video
      check (
        (media_kind = 'photo' and expires_at is null)
        or
        (media_kind = 'video' and expires_at is not null)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. How long the video runs, for the 45-second limit and the card label
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists duration_seconds numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_duration_sane') then
    alter table public.photos
      add constraint photos_duration_sane
      check (duration_seconds is null or (duration_seconds > 0 and duration_seconds <= 60));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Index used only by the expiry sweep. Partial, so it stays tiny and
--    indexes no photos at all.
-- ---------------------------------------------------------------------------
create index if not exists photos_video_expiry_idx
  on public.photos (expires_at)
  where media_kind = 'video';

-- ---------------------------------------------------------------------------
-- 5. Let the private bucket accept the one video format both of you can
--    reliably play. HEVC/.mov is deliberately NOT accepted: Safari plays it,
--    desktop Chrome and Firefox usually do not, so it would store memories
--    one of you could not watch.
--
--    public stays false. The 25 MB ceiling is unchanged and already sits
--    above the 20 MB app limit.
-- ---------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif',
      'video/mp4'
    ]
where id = 'memories';

-- ---------------------------------------------------------------------------
-- 6. No RLS change. The existing row-level policies on public.photos and on
--    storage.objects are row-scoped and already cover these columns and any
--    video file, behind the same public.is_allowed() gate.
-- ---------------------------------------------------------------------------

-- ===========================================================================
--  PROOF + the scheduler answer I still need.
--  Expect ONE row from the first query reading:  25 | 25 | 0 | 3 | false
--  and then one or two rows from the second naming pg_cron / pg_net.
-- ===========================================================================
select
  (select count(*) from public.photos)                                   as total_rows,
  (select count(*) from public.photos where media_kind = 'photo')        as photos,
  (select count(*) from public.photos where media_kind = 'video')        as videos,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'photos'
       and column_name in ('media_kind','expires_at','duration_seconds')) as new_columns,
  (select public from storage.buckets where id = 'memories')             as bucket_public;

select
  name,
  default_version    as available_version,
  installed_version,
  case when installed_version is not null then 'INSTALLED' else 'available' end as status
from pg_available_extensions
where name in ('pg_cron', 'pg_net')
order by name;
