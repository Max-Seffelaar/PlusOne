-- approve_quota_request: lock the request row and only flip a still-pending one
-- (PR #341 review, z8uq9m0y1y).
--
-- THE RACE
--
-- The 20260624160000 definition reads the request without a row lock and its
-- final UPDATE has no status predicate. Two admins, READ COMMITTED:
--
--   A: approve_quota_request(r)  -> SELECT sees r pending, passes every check
--   B: PATCH deny r              -> UPDATE 1, commits (r = denied)
--   A: upsert event_quotas override, UPDATE r set approved -> UPDATE 1
--
-- End state: approved + override raised, the deny silently overwritten. Not a
-- privilege escalation (A is an authorized admin; both writes are audited), but
-- a decision the venue already made gets reversed without anyone choosing to.
-- The reverse order was already safe: a deny's RLS USING (status = 'pending')
-- is re-evaluated on the updated tuple and matches nothing.
--
-- THE FIX (and nothing else)
--
-- 1. `select … for update` on the request row. A concurrent deny now either
--    commits first (the locked re-read sees 'denied' -> 45003, no override is
--    written) or waits for this transaction.
-- 2. `and status = 'pending'` on the final UPDATE plus a row-count check that
--    raises the same 45003 as the up-front check — belt and braces should the
--    lock ever be dropped from a future definition.
--
-- Unchanged from 20260624160000: signature, `returns void`, SECURITY DEFINER,
-- `set search_path = ''`, the error codes/messages (P0002, 45003, 42501), the
-- override maths, and the audit behaviour (audit_trigger on event_quotas and
-- quota_requests fires exactly as before). `create or replace` keeps the ACL
-- from 20260613180000 (EXECUTE: authenticated, service_role; revoked from
-- public/anon) — asserted in quota_requests_column_grant.test.sql F.

create or replace function public.approve_quota_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.quota_requests;
  v_venue uuid;
  v_current int;
  v_rows int;
begin
  select * into v_req from public.quota_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception using errcode = 'P0002', message = 'Quota-verzoek niet gevonden.';
  end if;
  if v_req.status <> 'pending' then
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;

  v_venue := public.event_venue(v_req.event_id);
  if not public.has_venue_role(v_venue, '{admin}'::public.venue_role[]) then
    raise exception using errcode = '42501',
      message = 'Alleen een admin mag quota-verzoeken goedkeuren.';
  end if;

  -- New override = the requester's current effective quota + the granted extra.
  v_current := public.user_event_quota(v_req.event_id, v_req.user_id);
  insert into public.event_quotas (event_id, user_id, quota_override)
  values (v_req.event_id, v_req.user_id, v_current + v_req.requested_extra)
  on conflict (event_id, user_id)
  do update set quota_override = excluded.quota_override;

  update public.quota_requests
  set status = 'approved',
      decided_by = (select auth.uid()),
      decided_at = now()
  where id = p_request_id
    and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    -- Unreachable while the row lock above holds; raising rolls back the
    -- override written a few lines up.
    raise exception using errcode = '45003',
      message = 'Dit verzoek is al afgehandeld.';
  end if;
end;
$$;
