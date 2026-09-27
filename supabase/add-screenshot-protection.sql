-- ===========================================================================
--  Our Little World — per-account privacy flag
--
--  Adds ONE boolean column to public.allowed_users and turns it on for one
--  existing row, addressed by its real user_id.
--
--  It does NOT create or alter any RLS policy, does not touch authentication,
--  and does not read or modify photos, videos, comments, favorites,
--  notifications or Recreate Someday items. Safe to run more than once.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  1. The column
--
--  Defaults to false, so every account is unprotected until explicitly set.
--  Adding a column needs no policy change: the existing
--  "roster is readable by the two of you" SELECT policy already covers every
--  column of this table, including ones added later.
-- ---------------------------------------------------------------------------
alter table public.allowed_users
  add column if not exists screenshot_protection boolean not null default false;


-- ---------------------------------------------------------------------------
--  2. Turn it on for exactly one account
--
--  Addressed by user_id — the same identifier the server trusts in
--  getViewer() — never by display name or email. These two uuids are the
--  ones currently in your allowed_users table.
--
--  The guard makes a typo loud instead of silent: if either uuid is not
--  present the whole migration aborts and nothing is changed.
-- ---------------------------------------------------------------------------
do $$
declare
  subbha constant uuid := 'd1b3c99a-0aff-4f5e-bf00-d9e8ca2cbe08';
  arafat constant uuid := '121c00eb-ef9d-4584-aa95-c00d59180db8';
begin
  if not exists (select 1 from public.allowed_users where user_id = subbha) then
    raise exception 'user_id % is not in allowed_users — nothing was changed.', subbha;
  end if;
  if not exists (select 1 from public.allowed_users where user_id = arafat) then
    raise exception 'user_id % is not in allowed_users — nothing was changed.', arafat;
  end if;

  -- Protected.
  update public.allowed_users
     set screenshot_protection = true
   where user_id = subbha;

  -- Explicitly unprotected, so re-running this file always restores the
  -- intended state rather than leaving a stale flag behind.
  update public.allowed_users
     set screenshot_protection = false
   where user_id = arafat;
end $$;


-- ---------------------------------------------------------------------------
--  3. OPTIONAL — stop the flag being switched off by the account it applies to
--
--  You can skip this section. Read it first and decide.
--
--  WHY IT EXISTS
--  The existing policy "you may rename yourself" allows an account to UPDATE
--  its own row, and an RLS policy cannot restrict WHICH columns. So without
--  this, the protected account can turn its own flag off from the browser
--  console with a single request, and the change sticks.
--
--  WHAT IT DOES
--  It changes column-level GRANTs, NOT row level security. No policy is
--  created, altered or dropped, and authentication is untouched. Table-wide
--  UPDATE is replaced by UPDATE on display_name only — so renaming yourself
--  still works exactly as before, while screenshot_protection, user_id and
--  created_at become read-only to both accounts.
--
--  Afterwards the flag can only be changed by you from this SQL editor, or by
--  the service_role key, which lives solely inside Supabase.
--
--  This is a tightening, never a loosening. If you would rather leave
--  permissions exactly as they are today, delete this section.
-- ---------------------------------------------------------------------------
revoke update on public.allowed_users from authenticated;
grant  update (display_name) on public.allowed_users to authenticated;


-- ---------------------------------------------------------------------------
--  4. Make the new column visible to the API immediately
--
--  PostgREST caches the schema; this avoids a "column not found in the schema
--  cache" surprise on the first request after the migration.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ===========================================================================
--  VERIFICATION
--
--  Expect exactly two rows:
--
--    display_name | screenshot_protection | can_rename | can_change_flag
--    -------------+-----------------------+------------+----------------
--    Arafat       | false                 | true       | false
--    Subbha       | true                  | true       | false
--
--  can_rename stays true — renaming yourself still works.
--  can_change_flag is false only if you kept section 3; if you deleted that
--  section it will read true, which is the pre-existing behaviour.
-- ===========================================================================
select
  display_name,
  screenshot_protection,
  has_column_privilege('authenticated', 'public.allowed_users', 'display_name', 'UPDATE')
    as can_rename,
  has_column_privilege('authenticated', 'public.allowed_users', 'screenshot_protection', 'UPDATE')
    as can_change_flag
from public.allowed_users
order by created_at;
