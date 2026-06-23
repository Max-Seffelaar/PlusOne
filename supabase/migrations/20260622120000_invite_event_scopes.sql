-- S4.1 — Invite: optional event-organizer scope, applied on acceptance.
--
-- The team-invite form (po S6 "Gebruiker uitnodigen") may now also grant
-- event-organizer scope (#6/#24) on one or more events of the inviting venue,
-- alongside the venue roles. We capture the chosen event ids on the invite and
-- turn them into event_organizers rows when the invitee ACCEPTS — i.e. running
-- as the invitee themselves (auth.uid()), exactly like the membership grant.
--
-- Why store-then-apply (mirrors the #4 default_quota flow): at invite time the
-- invitee may be a brand-new account OR an existing one at another venue. We
-- deliberately do NOT resolve an existing user's id by e-mail server-side (the
-- privacy stance inviteOrganizer documents — no enumeration, no service-role
-- profile snooping). Parking the event ids on the invite and granting on
-- acceptance works uniformly for both and keeps the user's own id as the actor.
--
-- Attaching event scope is an ADMIN-only grant (mirrors assignOrganizer, which
-- is admin + AAL2): a user_manager may invite staff but may not hand out
-- organizer scope. Enforced in RLS (invites_insert) as the real boundary, and
-- re-checked in the action for a precise message.

alter table public.invites
  add column event_ids uuid[] not null default '{}';

comment on column public.invites.event_ids is
  'Optional event-organizer scope captured at invite time (#6/#24). Each event of the invite''s venue becomes an event_organizers row on acceptance; cross-venue ids are ignored. Admin-only (RLS).';

-- Tighten the insert policy: event_ids may be non-empty only for an admin of the
-- venue. Every other clause is unchanged from 20260613190000_auth_invites_sessions.sql.
drop policy invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and public.is_aal2()
    and invited_by = (select auth.uid())
    and accepted_at is null
    and expires_at > now()
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
    -- Event-organizer scope is admin-only (mirrors assignOrganizer).
    and (
      cardinality(event_ids) = 0
      or public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
    )
  );

-- Recreate the acceptance RPC: identical provisioning + role-merge + quota-seed
-- as the #4 version (20260617010000), plus — per accepted invite — grant
-- event-organizer scope for the captured events that belong to the invite's
-- venue. Idempotent (DO NOTHING); cross-venue ids are filtered as defence in
-- depth. CREATE OR REPLACE keeps the function's grants + revoke-from-public.
create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    return 0;
  end if;

  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email)
    into v_email, v_full_name
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return 0;
  end if;

  -- Profile is owned by the user (decision #24); create it on first acceptance.
  insert into public.user_profiles (id, full_name, email)
  values (v_uid, v_full_name, v_email)
  on conflict (id) do nothing;

  for r in
    select i.id, i.venue_id, i.roles, i.default_quota, i.event_ids
    from public.invites i
    where i.accepted_at is null
      and i.expires_at > now()
      and lower(i.email) = v_email
    for update
  loop
    insert into public.venue_memberships as vm (venue_id, user_id, roles)
    values (r.venue_id, v_uid, r.roles)
    on conflict (venue_id, user_id) do update
      set roles = (
        select array(
          select distinct e
          from unnest(vm.roles || excluded.roles) as e
        )::public.venue_role[]
      );

    -- #4: seed the venue default quota captured on the invite, once. DO NOTHING
    -- so re-accepting an old invite never overwrites a quota an admin has since
    -- adjusted (the invite seeds a quota, it does not manage it).
    if r.default_quota is not null then
      insert into public.quotas (venue_id, user_id, default_count)
      values (r.venue_id, v_uid, r.default_quota)
      on conflict (venue_id, user_id) do nothing;
    end if;

    -- #6/#24: grant any event-organizer scope captured on the invite, limited to
    -- events of the invite's venue. Idempotent across re-acceptance; an id from
    -- another venue (or a since-deleted event) is silently skipped by the join.
    insert into public.event_organizers (event_id, user_id)
    select e.id, v_uid
    from unnest(r.event_ids) as eid
    join public.events e on e.id = eid and e.venue_id = r.venue_id
    on conflict (event_id, user_id) do nothing;

    update public.invites
      set accepted_at = now(), accepted_by = v_uid
      where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
