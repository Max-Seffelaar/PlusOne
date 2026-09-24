-- L5 (fresh-session review of PR #308, 2026-09-18; pre-existing) — a client
-- write on guest_requests can only DENY a pending request.
--
-- THE BUG
--
-- guest_requests_decide (20260613120000) pins the OLD row (`status = 'pending'`,
-- admin or organizer) and the actor (`decided_by = auth.uid()`), but not the NEW
-- status, and `authenticated` holds a table-wide UPDATE. So an admin/organizer
-- could PATCH /rest/v1/guest_requests straight through PostgREST:
--
--   update guest_requests set status = 'approved', decided_by = <self>,
--          decided_at = now() where id = <pending request>;   -- UPDATE 1
--
-- and it succeeded with no guest row created: approve_guest_request (the only
-- path that inserts the guest, checks tier-max 45002 / capacity 45005 /
-- link-max 45006 and attributes the approver) never ran. /r/[token] then shows
-- the requester "approved" (and, since 20260919090000, the venue address) for
-- a request that has nobody on the list, and the door turns them away.
-- Reproduced on the local stack before writing this, in a rolled-back
-- transaction.
--
-- The same table-wide grant let the deny path rewrite any other column of the
-- row in the same PATCH: event_id (move a request to another event the actor
-- administers), full_name/email/phone (rewrite what the requester submitted,
-- unaudited: audit_guest_requests diffs a decision, it does not guard fields),
-- status_token_hash, request_link_id, anonymized_at, dedupe_key, plus_ones.
--
-- THE LEGITIMATE CLIENT WRITE (verified, not assumed)
--
-- Exactly one: denyGuestRequest (src/features/requests/actions.ts), a plain
-- RLS-gated update that writes status = 'denied', decided_by, decided_at,
-- decision_reason, filtered on `status = 'pending'`. No other client code
-- updates or upserts guest_requests (src/, scripts/, supabase/functions).
--
-- Every other write is a SECURITY DEFINER function owned by postgres, so it
-- runs as the table owner and neither the policy nor the column grant below
-- applies to it: approve_guest_request (incl. re-approving a denied request,
-- 20260621120000), submit_guest_request (insert, silent dedup, auto-approve),
-- run_privacy_retention. Each `update public.guest_requests` in
-- supabase/migrations/ was checked to sit inside one of those.
--
-- THE FIX — two layers, each closing what the other cannot
--
--   1. The policy's WITH CHECK now requires `status = 'denied'`. With USING
--      still `status = 'pending'`, the only transition a client can make is
--      pending -> denied. approved/denied rows match no row at all (UPDATE 0),
--      so nothing is un-approved, un-denied or re-decided by hand. USING also
--      gains `anonymized_at is null`, so an anonymized request is frozen for
--      the client exactly as approve_guest_request already freezes it (P0002,
--      20260919090000): without it a deny writes a fresh free-text
--      decision_reason — and an audit diff carrying it — onto a row the
--      retention job (#29) has already scrubbed, and it sits there until the
--      next run. The approvals inbox hides anonymized requests, so no
--      legitimate deny is lost.
--   2. UPDATE is granted per column: status, decided_by, decided_at,
--      decision_reason, i.e. exactly what the deny path writes. A PATCH that
--      names any other column is refused (42501) before RLS runs. A column
--      grant is also closed by default: a column added later is not
--      client-writable until a migration grants it, where the table-wide grant
--      opened every future column silently.
--
-- A policy cannot compare OLD with NEW, so (1) alone leaves every other column
-- writable during a deny; (2) alone would still let the status column be set to
-- 'approved'. Together: pending -> denied on four columns, nothing else.
--
-- RELATION TO 20260919090000 (guard_guest_request_decision_fields)
--
-- That migration added a BEFORE UPDATE trigger refusing client changes to
-- plus_ones, approved_plus_ones and decision_message. Its comment says
-- `authenticated` holds a table-wide UPDATE; from here on it does not. This
-- migration does not duplicate the trigger: no trigger here, and none of those
-- columns is named, so none of them is granted. The column grant now refuses
-- those writes first, and the trigger stays as a second layer that also covers
-- a future re-grant. partial_approval.test.sql E1/E2 assert errcode 42501 with
-- no message, which both layers raise; its deny-path tests E3/G2 write exactly
-- the four granted columns.
--
-- NOT CHANGED: SELECT and INSERT for authenticated. INSERT stays pinned to
-- status = 'pending' by guest_requests_insert_public, so it cannot plant an
-- approved row. An upsert's ON CONFLICT DO UPDATE is an UPDATE and gets both
-- layers.
--
-- Expand-contract: the deployed app only ever writes the four granted columns
-- with status = 'denied', so it keeps working unchanged.

-- ---------------------------------------------------------------------------
-- 1. A client decision is a denial, nothing else
-- ---------------------------------------------------------------------------
-- USING is restated in full so the whole policy reads in one place; the only
-- change to it is `anonymized_at is null` (WITH CHECK needs no counterpart:
-- anonymized_at has no column UPDATE grant, so a client cannot set it).
alter policy guest_requests_decide on public.guest_requests
  using (
    status = 'pending'
    and anonymized_at is null
    and (
      public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  )
  with check (
    status = 'denied'
    and decided_by = (select auth.uid())
    and (
      public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  );

comment on policy guest_requests_decide on public.guest_requests is
  'Client decision on a landing request = DENY only: pending -> denied by an admin of the venue or an organizer of the event, as themselves. Anonymized rows match nothing (#29), like approve_guest_request. Approval goes through approve_guest_request (SECURITY DEFINER), never a direct write. Column UPDATE grants limit the write to status/decided_by/decided_at/decision_reason (20260919150000).';

-- ---------------------------------------------------------------------------
-- 2. ...and it touches the deny columns only
-- ---------------------------------------------------------------------------
-- A table-level REVOKE also revokes any column privileges of the same kind
-- (there are none today), so the column grant must come after it. A column
-- grant does not need the table-level privilege: this is the documented way to
-- make a subset of columns updatable. SELECT/INSERT are untouched.
revoke update on table public.guest_requests from authenticated;
grant update (status, decided_by, decided_at, decision_reason)
  on table public.guest_requests to authenticated;
