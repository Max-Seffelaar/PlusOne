-- Security-audit 4.2 — close a quota-bypass: a NON-EXEMPT user must not be able
-- to FORGE guests.source on a direct insert (decisions #22/#31/#11, CLAUDE.md
-- "RLS is the security boundary; quota is enforced in the DB, not the UI").
--
-- THE HOLE (found by attacker_quota_bypass.test.sql):
--   guest_personal_contribution() — and therefore enforce_guest_quota() — treats
--   source in ('landing','permanent') as 0 personal-quota slots (#31/#11). The
--   guests_insert policy only checked can_write_guests() + added_by = auth.uid();
--   it did NOT constrain `source`. The anon/auth API key ships to the browser, so
--   any staffer/doorhost could POST /rest/v1/guests with source='landing' (or
--   'permanent') and added_by=self and the quota trigger would skip them entirely
--   — unlimited free slots, exactly the fraud the quota engine exists to stop.
--
-- THE FIX (surgical — smallest blast radius, precise threat match):
--   A direct authenticated insert may set source in ('landing','permanent') ONLY
--   when the adder is quota-EXEMPT (venue admin / event organizer). Exempt adders
--   have no personal limit, so they cannot "bypass" anything; non-exempt staff and
--   doorhost are pinned to ('app','door') — the two sources the real client paths
--   actually use (quick-add = 'app', door add-on-the-spot = 'door').
--   The legitimate 'landing'/'permanent' producers are SECURITY DEFINER RPCs
--   (approve_guest_request → 'landing'; sync_permanent_guests_into_event →
--   'permanent') that run as the table owner past RLS, so this WITH CHECK never
--   touches them; the seed runs as superuser and is likewise unaffected. And by
--   design those RPCs always stamp added_by = the approving admin/organizer, i.e.
--   an exempt user — so the source→0 quota rule is only ever load-bearing for the
--   forge this guard now blocks.
--
-- The helper functions used here (event_venue / has_venue_role / is_event_organizer)
-- are the same STABLE SECURITY DEFINER helpers other guests policies already use,
-- and are executable by `authenticated`. The Zod guestSource enum is narrowed to
-- ('app','door') in the same change (defense in depth — RLS stays the boundary).

alter policy guests_insert on public.guests
  with check (
    public.can_write_guests(event_id)
    and added_by = (select auth.uid())
    and (
      -- the only sources a direct client insert legitimately produces …
      source in ('app', 'door')
      -- … unless the adder is quota-exempt (no personal limit to bypass): admin
      -- of the venue or organizer of the event may also carry the RPC-only
      -- sources. A non-exempt staffer/doorhost forging them is rejected here.
      or public.has_venue_role(public.event_venue(event_id), '{admin}'::public.venue_role[])
      or public.is_event_organizer(event_id)
    )
  );
