-- ===========================================================================
--  Our Little World — fix: un-loving could not retract its notification
--
--  WHY THIS IS NEEDED
--  add-notifications.sql gave the sender a DELETE policy so that un-loving
--  would take back an unread "… loved your memory". That policy can never
--  match. PostgreSQL applies the SELECT policies when it locates the rows for
--  a DELETE, and the SELECT policy deliberately hides the other person's
--  inbox — so the sender cannot find the row, the delete quietly removes
--  nothing, and the unique index then refuses to let them ever love that item
--  again.
--
--  Loosening the SELECT policy would let each of you read the other's inbox,
--  which is exactly what must not happen. So the retraction moves into a
--  SECURITY DEFINER function whose WHERE clause is pinned to the caller.
--
--  ADDITIVE AND CORRECTIVE ONLY. Creates one function, drops one policy that
--  never worked. Touches no data, no other policy, and no other table.
--  Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Remove the policy that cannot match
-- ---------------------------------------------------------------------------
drop policy if exists "retract your own unread" on public.notifications;


-- ---------------------------------------------------------------------------
--  2. Retraction as a function
--
--  SECURITY DEFINER so it can reach a row the caller is not allowed to read.
--  That is safe because the caller cannot choose whose row: actor_id is
--  pinned to auth.uid(), the type is pinned to 'favorite', and is_read = false
--  means a notice already seen can never be erased. The only thing a caller
--  can remove is an unread love notice they themselves sent.
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
--  Expect:  4 | true
--           (the broken 5th policy is gone; the function exists)
-- ===========================================================================
select
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'notifications')        as policies,
  exists (select 1 from pg_proc p
            join pg_namespace pn on pn.oid = p.pronamespace
           where pn.nspname = 'public'
             and p.proname = 'retract_favorite_notification')            as retract_fn;
