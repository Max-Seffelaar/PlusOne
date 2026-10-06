-- Legal v0.3 E1 — self-service venue data export (z8uq9m2hm6,
-- legal-v03-plan §3 E1, decisions 1 + 2).
--
-- A venue admin downloads every piece of personal data the venue holds as CSV
-- (`exportVenueData`, src/features/export/actions.ts). The export READS through
-- the admin's own user-scoped client, so RLS is what scopes every row to the
-- venue. This migration adds the two database pieces the export needs:
--
--   1. public.log_venue_export(...) — writes ONE audit_log row (action
--      'export', entity 'venues') per download. This is the one deliberate
--      exception to "reads are not audited" (CLAUDE.md rule 4): an export moves
--      the whole guest list out of the platform, so it leaves a trail. A
--      platform admin exporting a venue where they hold no admin membership
--      also gets a platform_access_log row (B3's trail of app-level access).
--   2. public.contact_marketing_opt_ins(venue) — which contacts are currently
--      opted in to venue updates (decision 2). Contacts carry no opt-in column;
--      the consent lives on guest_requests.marketing_opt_in. One derivation in
--      SQL, used by the export's contacts.csv AND the contacts screen (badge +
--      filter), so the two can never disagree.
--
-- ── Why log_venue_export is SECURITY DEFINER, not INVOKER ─────────────────────
-- The plan asked for a SECURITY INVOKER RPC. Under the current grant matrix
-- that cannot work: `authenticated` holds SELECT only on audit_log
-- (20260613000000: "written by triggers only (#4)"), and there is no INSERT
-- policy. Making INVOKER work would mean granting INSERT on audit_log to
-- `authenticated` plus a policy — and then any venue member could forge
-- arbitrary audit rows (any action, any entity, any diff) through raw
-- PostgREST. That breaks the one property the audit log exists for.
--
-- So the safest correct form is a narrow SECURITY DEFINER function, the same
-- pattern set_platform_admin (20260923120000) already uses to write audit rows:
--   * actor is always auth.uid() — never a parameter;
--   * action is the constant 'export', entity the constant 'venues';
--   * the caller must hold `admin` at p_venue_id (has_venue_role, which also
--     admits platform admins per decision #49 — their export lands under their
--     own uid, visible to the venue like every other audit row);
--   * an event scope must be an event OF that venue (no scope mismatch);
--   * the diff is built from four bounded integers, never from client JSON;
--   * search_path = '' and every reference schema-qualified.
-- audit_log itself keeps SELECT-only for authenticated: nothing about its grant
-- matrix changes here.
--
-- What the row does NOT prove: that the rows were actually downloaded, or that
-- the counts are true. The counts come from the server action (server code, not
-- the browser), but a venue admin with raw API access could call the RPC with
-- made-up counts — or read the same rows through PostgREST without calling it at
-- all. Both were already possible before E1 (RLS lets an admin read their venue);
-- the row is a trail of in-app exports, not a gate. A forged row can only ever
-- name the caller themself as actor, at a venue they administer.

-- ---------------------------------------------------------------------------
-- 1. log_venue_export
-- ---------------------------------------------------------------------------

create or replace function public.log_venue_export(
  p_venue_id uuid,
  p_guests integer,
  p_contacts integer,
  p_requests integer,
  p_door integer,
  -- Last and defaulted: a venue-wide export simply omits it (the generated
  -- types then read `p_event_id?: string`, no null cast at the call site).
  p_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_venue_id is null
     or p_guests is null or p_contacts is null
     or p_requests is null or p_door is null
     or least(p_guests, p_contacts, p_requests, p_door) < 0
     -- The export refuses above 50 000 rows per table (plan §3 E1), so a
     -- larger count can only be a hand-made call.
     or greatest(p_guests, p_contacts, p_requests, p_door) > 50000 then
    raise exception 'log_venue_export: invalid arguments' using errcode = '22023';
  end if;

  -- Generic on purpose: the caller learns nothing about a venue they don't
  -- administer, nor whether an event id exists elsewhere.
  if not public.has_venue_role(p_venue_id, '{admin}'::public.venue_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events e
     where e.id = p_event_id and e.venue_id = p_venue_id
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- A platform admin (decision #49) passes has_venue_role at every venue. When
  -- they export a venue where they are not a real admin member, that is
  -- cross-venue access through the app, so it also lands in
  -- platform_access_log (legal v0.3 B3, decision 3), exactly like a venue
  -- switch would. Written here, by the definer, so the table's policies stay
  -- as B3 made them; created_at is still server-stamped by its trigger.
  if public.is_platform_admin() and not exists (
    select 1 from public.venue_memberships m
     where m.venue_id = p_venue_id
       and m.user_id = v_actor
       and 'admin' = any (m.roles)
  ) then
    insert into public.platform_access_log (admin_id, venue_id, reason)
    values (v_actor, p_venue_id, 'export');
  end if;

  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  values
    (v_actor, p_venue_id, p_event_id, 'venues', p_venue_id, 'export',
     jsonb_build_object(
       'scope', case when p_event_id is null then 'venue' else 'event' end,
       'rows', jsonb_build_object(
         'guests', p_guests,
         'contacts', p_contacts,
         'requests', p_requests,
         'door', p_door)),
     public.request_device_id())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_venue_export(uuid, integer, integer, integer, integer, uuid) is
  'Legal v0.3 E1: one audit_log row (action export, entity venues) per in-app '
  'data export. Venue admins only; actor is always auth.uid(); an event scope '
  'must belong to the venue; a platform admin without an admin membership '
  'also gets a platform_access_log row. SECURITY DEFINER because authenticated has no '
  'INSERT on audit_log (and must not: that would allow forged audit rows).';

-- `authenticated` only. anon has no uid (the body refuses anyway, but a dead
-- privilege on an audit writer is not worth having). service_role carries no
-- `sub` either, and no server flow exports through the service key.
revoke execute on function public.log_venue_export(uuid, integer, integer, integer, integer, uuid)
  from public, anon, service_role;
grant execute on function public.log_venue_export(uuid, integer, integer, integer, integer, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. contact_marketing_opt_ins
-- ---------------------------------------------------------------------------
-- A contact counts as opted in when the LATEST request this venue received from
-- the same person (same normalised e-mail, or same phone digits — the keys the
-- contacts table, upsert_contacts and guests_autolink_contact already share)
-- has marketing_opt_in = true. Latest, not "any": someone who ticked the box
-- once and left it unticked on a later request has withdrawn (AVG art. 7(3)).
--
-- SECURITY INVOKER: contacts and guest_requests RLS both apply, so the result is
-- role-relative — admin/finance see their venue's, an organizer only matches
-- requests of events they organise, staff/doorhost get nothing. Anonymised rows
-- (#29) never match: their contact fields are scrubbed, and they are excluded
-- explicitly on both sides as well.

create or replace function public.contact_marketing_opt_ins(p_venue_id uuid)
returns table (contact_id uuid, opted_in_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with req as (
    select
      nullif(lower(btrim(coalesce(gr.email, ''))), '') as email_norm,
      nullif(regexp_replace(coalesce(gr.phone, ''), '[^0-9]', '', 'g'), '') as phone_norm,
      gr.marketing_opt_in,
      gr.created_at,
      gr.id
    from public.guest_requests gr
    where gr.venue_id = p_venue_id
      and gr.anonymized_at is null
  ),
  c as (
    select ct.id, ct.email_norm, ct.phone_norm
    from public.contacts ct
    where ct.venue_id = p_venue_id
      and ct.anonymized_at is null
  ),
  matched as (
    -- Two equi-joins instead of one OR-join, so the planner can hash both.
    select c.id as contact_id, req.marketing_opt_in, req.created_at, req.id as request_id
      from c join req on req.email_norm = c.email_norm
    union all
    select c.id, req.marketing_opt_in, req.created_at, req.id
      from c join req on req.phone_norm = c.phone_norm
  ),
  latest as (
    select distinct on (m.contact_id) m.contact_id, m.marketing_opt_in, m.created_at
      from matched m
     order by m.contact_id, m.created_at desc, m.request_id desc
  )
  select l.contact_id, l.created_at
    from latest l
   where l.marketing_opt_in
   order by l.contact_id;
$$;

comment on function public.contact_marketing_opt_ins(uuid) is
  'Legal v0.3 E1 / decision 2: contacts of a venue whose latest matching guest '
  'request (normalised e-mail or phone) has marketing_opt_in = true. SECURITY '
  'INVOKER — role-relative through contacts + guest_requests RLS.';

revoke execute on function public.contact_marketing_opt_ins(uuid) from public, anon;
grant execute on function public.contact_marketing_opt_ins(uuid) to authenticated;
