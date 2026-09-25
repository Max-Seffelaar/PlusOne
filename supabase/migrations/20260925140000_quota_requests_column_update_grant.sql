-- quota_requests: a client write can only DENY a pending request, and it
-- touches the four deny columns only. Found in the N2 push-backend review
-- (PR #336); mirrors 20260919150000 (guest_requests, L5).
--
-- THE BUG
--
-- `authenticated` holds a table-wide UPDATE on quota_requests (20260613000000),
-- and quota_requests_decide_admin (last restated in 20260624160000) pins the OLD
-- row (`status = 'pending'`, admin of the event's venue) and the actor
-- (`decided_by = auth.uid()`), but neither the NEW status nor any other column.
-- So an admin could PATCH /rest/v1/quota_requests straight through PostgREST:
--
--   * rewrite what the request IS in the same PATCH as a deny: user_id (pin the
--     denial — and the push it enqueues, see below — on another member),
--     event_id / venue_id (move the request to another event/venue the actor
--     administers), requested_extra, motivation (rewrite what the requester
--     submitted), created_at (backdate it). The audit trigger diffs the change,
--     but nothing refuses it.
--   * approve by a direct write: `set status = 'approved', decided_by = <self>,
--     decided_at = now()` succeeds with UPDATE 1 and NO event_quotas override —
--     approve_quota_request (the only path that raises the requester's quota
--     atomically with the status flip) never ran. The requester is told
--     "approved" (UI + the N2 push, 20260925120000) for slots they do not have.
--
-- N2's enqueue trigger already reads old.user_id, so a rewritten user_id cannot
-- redirect a push; this migration closes the table itself.
--
-- THE LEGITIMATE CLIENT WRITES (verified, not assumed)
--
--   * INSERT — requestExtraSlots (src/features/quotas/actions.ts): event_id,
--     user_id, requested_extra, motivation. Untouched here (INSERT grant and
--     quota_requests_insert_own stay as they are).
--   * UPDATE — exactly one: decideQuotaRequest's deny branch (same file), a
--     plain RLS-gated update writing status = 'denied', decided_by, decided_at,
--     decision_reason. There is no staff cancel/withdraw path; no other code in
--     src/, scripts/ or supabase/functions updates or upserts quota_requests
--     (scripts/perf only reads it).
--
-- Every other write is a SECURITY DEFINER function owned by postgres, which runs
-- as the table owner so neither the policy nor the column grant applies:
-- approve_quota_request (20260624160000, the approve path). The BEFORE trigger
-- set_event_scope (20260708120000/20260713160000) assigns NEW.venue_id itself;
-- column privileges are checked against the statement's SET list, not against
-- what a trigger writes, so it keeps working.
--
-- THE FIX — two layers, as in 20260919150000
--
--   1. The policy's WITH CHECK now requires `status = 'denied'`. USING still
--      pins `status = 'pending'`, so the only client transition is
--      pending -> denied; decided rows match nothing (UPDATE 0). Approving is
--      approve_quota_request only.
--   2. UPDATE is granted per column: status, decided_by, decided_at,
--      decision_reason — exactly what the deny path writes. A PATCH naming any
--      other column is refused with 42501 before RLS runs. A column grant is
--      also closed by default for columns added later.
--
-- A policy cannot compare OLD with NEW, so (1) alone leaves every other column
-- writable during a deny; (2) alone still lets status be set to 'approved'.
--
-- NOT CHANGED: SELECT and INSERT for authenticated, the select/insert policies,
-- anon (holds nothing on this table). An upsert's ON CONFLICT DO UPDATE is an
-- UPDATE and gets both layers.
--
-- Expand-contract: the deployed app only ever sends the four granted columns,
-- with status = 'denied', so it keeps working unchanged.

-- ---------------------------------------------------------------------------
-- 1. A client decision is a denial, nothing else
-- ---------------------------------------------------------------------------
-- USING is restated unchanged so the whole policy reads in one place.
alter policy quota_requests_decide_admin on public.quota_requests
  using (
    status = 'pending'
    and public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
  )
  with check (
    status = 'denied'
    and decided_by = (select auth.uid())
    and public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
  );

comment on policy quota_requests_decide_admin on public.quota_requests is
  'Client decision on a quota request = DENY only: pending -> denied by an admin of the event''s venue, as themselves. Approval goes through approve_quota_request (SECURITY DEFINER, raises the override atomically), never a direct write. Column UPDATE grants limit the write to status/decided_by/decided_at/decision_reason (20260925140000).';

-- ---------------------------------------------------------------------------
-- 2. ...and it touches the deny columns only
-- ---------------------------------------------------------------------------
-- Revoke first, then grant: a table-level REVOKE also drops column privileges
-- of the same kind (none exist today), so the column grant must come after it.
revoke update on table public.quota_requests from authenticated;
grant update (status, decided_by, decided_at, decision_reason)
  on table public.quota_requests to authenticated;
