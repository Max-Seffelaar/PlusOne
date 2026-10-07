-- Explicit invite accept / decline (z8uq9m2yvp follow-up to 20261007140000_crew_invites.sql;
-- decision Max 2026-10-07).
--
-- Max's privacy rule: "Data only becomes visible once it has been filled in, the
-- user has been added and the invite has been accepted." 20261007140000 made that
-- true for crew invites. A TEAM invite still auto-accepted at login: any company
-- admin could type an existing account's address, and the next login made that
-- account a member, which opens its whole profile to the company
-- (can_view_profile, member leg). This migration removes the last auto-accept.
--
-- 1. invites.declined_at / declined_by: an invitee can decline. A declined invite
--    is closed (never accepted, never listed as open) and frees the pending-unique
--    slot, so the company can invite the person again later.
-- 2. Nothing accepts at login any more. accept_pending_invites() (the login /
--    consent entry point) becomes a deprecated shim that only makes sure the
--    caller's profile row exists and accepts nothing, team or crew. The new
--    ensure_my_profile() is what the app calls from now on.
-- 3. accept_invite(p_invite_id) accepts exactly ONE invite the caller was
--    addressed by, per tap in the Home banner or the onboarding invite step.
--    The accept body is unchanged from 20261007140000 (team: membership + quota +
--    event scopes; crew: one event_organizers row + quota on a NEW row, nothing
--    for a member of that company); only the entry point is per invite.
--    accept_my_invites() stays for ONE release as a thin loop over the same
--    worker, because the currently deployed app's banner still calls it
--    (expand-contract); the new app never does. Drop it in a follow-up.
-- 4. decline_invite(p_invite_id) closes ONE open invite addressed to the caller
--    and returns true only on the transition, so a retry never re-sends mail.
-- 5. declined_invite_mail_context(p_invite_id): service_role only. The server
--    action calls it AFTER decline_invite returned true, to mail the inviter
--    ("{typed e-mail address} declined ...", never the decliner's profile name)
--    and confirm to the decliner. The invitee must never read the inviter's
--    e-mail address, which is why this is not an app-role RPC.
-- 6. my_pending_invites() no longer lists declined invites (same signature).
-- 7. invites_update_resend: a declined invite can no longer be "resent".
-- 8. mail_log.type: two new types for the decline mails. They are logged with no
--    venue (the invitee caused them, not the company), so they never eat into
--    the company's 25-per-day invitation-mail cap.
--
-- Grant matrix: no new table or view. declined_at / declined_by sit under the
-- existing table-level grants on public.invites (select, insert, delete to
-- authenticated; update only on expires_at), so an app role cannot write them
-- directly: only decline_invite (SECURITY DEFINER) does. Functions: revoke from
-- public/anon first, then grant exactly what is callable.

-- ── 1. Columns, constraints, pending-unique ─────────────────────────────────

alter table public.invites
  add column declined_at timestamptz,
  add column declined_by uuid references public.user_profiles (id) on delete set null;

comment on column public.invites.declined_at is
  'Set by decline_invite() when the invitee declines. A declined invite is closed: not open, not acceptable, not resendable.';

alter table public.invites
  add constraint invites_not_accepted_and_declined_check
    check (accepted_at is null or declined_at is null),
  add constraint invites_declined_by_check
    check (declined_at is not null or declined_by is null);

-- A declined invite no longer holds the pending slot (a company may invite the
-- person again; the mail caps already bound how often).
drop index public.invites_pending_unique;
create unique index invites_pending_unique
  on public.invites (venue_id, lower(email))
  where accepted_at is null and declined_at is null and cardinality(roles) > 0;

drop index public.invites_pending_crew_unique;
create unique index invites_pending_crew_unique
  on public.invites (venue_id, lower(email), (event_ids[1]))
  where accepted_at is null and declined_at is null and cardinality(roles) = 0;

-- ── 2. Resend policy: only an open invite ───────────────────────────────────
alter policy invites_update_resend on public.invites
  using (
    accepted_at is null
    and declined_at is null
    and public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  )
  with check (
    accepted_at is null
    and declined_at is null
    and expires_at > now()
    and expires_at <= now() + interval '30 days'
    and public.has_venue_role(venue_id, '{admin,user_manager}'::public.venue_role[])
    and (
      public.has_venue_role(venue_id, '{admin}'::public.venue_role[])
      or not (roles @> '{admin}'::public.venue_role[])
    )
  );

-- ── 3. Login path: profile only, accept nothing ─────────────────────────────

create function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
begin
  if v_uid is null then
    return;
  end if;

  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email)
    into v_email, v_full_name
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return;
  end if;

  -- The profile is owned by the user (decision #24). Making sure it exists
  -- grants nothing: no membership, no event access, no invite is touched.
  insert into public.user_profiles (id, full_name, email)
  values (v_uid, v_full_name, v_email)
  on conflict (id) do nothing;
end;
$$;

comment on function public.ensure_my_profile() is
  'Login / consent entry point: make sure the caller has a user_profiles row. Accepts no invite. z8uq9m2yvp.';

create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deprecated shim for the app version that is still deployed while this
  -- migration lands: it used to accept team invites at login. It now accepts
  -- nothing, team or crew, and only keeps the old "profile exists" side effect.
  perform public.ensure_my_profile();
  return 0;
end;
$$;

comment on function public.accept_pending_invites() is
  'DEPRECATED (z8uq9m2yvp): accepts nothing. Invites are accepted one at a time with accept_invite(). Kept as a shim that only ensures the profile; drop with accept_my_invites() once the app no longer calls it.';

-- ── 4. Accept: one invite, on the invitee's explicit action ────────────────

drop function public.accept_invites_for_caller(boolean);

create function public.accept_invite_for_caller(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_new_crew uuid;
  r record;
begin
  if v_uid is null or p_invite_id is null then
    return false;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return false;
  end if;

  perform public.ensure_my_profile();

  -- Only the caller's OWN open, unexpired invite, locked so a double tap or a
  -- concurrent decline cannot act on it twice.
  select i.id, i.venue_id, i.roles, i.default_quota, i.event_ids, i.crew_quota
    into r
  from public.invites i
  where i.id = p_invite_id
    and i.accepted_at is null
    and i.declined_at is null
    and i.expires_at > now()
    and lower(i.email) = v_email
  for update;

  if not found then
    return false;
  end if;

  if cardinality(r.roles) > 0 then
    -- ── Team invite: body unchanged from 20261007140000 ──
    insert into public.venue_memberships as vm (venue_id, user_id, roles)
    values (r.venue_id, v_uid, r.roles)
    on conflict (venue_id, user_id) do update
      set roles = (
        select array(
          select distinct e
          from unnest(vm.roles || excluded.roles) as e
        )::public.venue_role[]
      );

    if r.default_quota is not null then
      insert into public.quotas (venue_id, user_id, default_count)
      values (r.venue_id, v_uid, r.default_quota)
      on conflict (venue_id, user_id) do nothing;
    end if;

    insert into public.event_organizers (event_id, user_id)
    select e.id, v_uid
    from unnest(r.event_ids) as eid
    join public.events e on e.id = eid and e.venue_id = r.venue_id
    on conflict (event_id, user_id) do nothing;
  else
    -- ── Crew-only invite: body unchanged from 20261007140000 ──
    -- A member of this company never becomes crew through an invite; the invite
    -- is consumed without effect.
    if not exists (
      select 1 from public.venue_memberships m
      where m.venue_id = r.venue_id and m.user_id = v_uid
    ) then
      insert into public.event_organizers (event_id, user_id)
      select e.id, v_uid
      from public.events e
      where e.id = r.event_ids[1] and e.venue_id = r.venue_id
      on conflict (event_id, user_id) do nothing
      returning event_id into v_new_crew;

      -- Quota only for a NEW crew row, and then the invite's value wins over a
      -- row left from an earlier crew spell. Someone who is still crew keeps theirs.
      if v_new_crew is not null and r.crew_quota is not null then
        insert into public.event_quotas (event_id, user_id, quota_override)
        values (v_new_crew, v_uid, r.crew_quota)
        on conflict (event_id, user_id) do update set quota_override = excluded.quota_override;
      end if;
    end if;
  end if;

  update public.invites
    set accepted_at = now(), accepted_by = v_uid
    where id = r.id;

  return true;
end;
$$;

comment on function public.accept_invite_for_caller(uuid) is
  'Internal worker for accept_invite() and the legacy accept_my_invites(): accepts ONE open invite addressed to the caller (auth.uid()). Not executable by app roles.';

create function public.accept_invite(p_invite_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.accept_invite_for_caller(p_invite_id);
$$;

comment on function public.accept_invite(uuid) is
  'The invitee''s explicit accept of ONE invite (Home banner, onboarding invite step). False when it is no longer open (expired, declined, accepted, not theirs). z8uq9m2yvp.';

-- Legacy (see header): the deployed banner's accept-all. Loops the same worker,
-- team invites first so a membership granted here counts for the crew check.
create or replace function public.accept_my_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select i.id
    from public.invites i
    join auth.users u on u.id = auth.uid()
    where i.accepted_at is null
      and i.declined_at is null
      and i.expires_at > now()
      and lower(i.email) = lower(u.email)
    order by cardinality(i.roles) desc, i.created_at
  loop
    if public.accept_invite_for_caller(r.id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function public.accept_my_invites() is
  'DEPRECATED (z8uq9m2yvp): accept-all for the app version still deployed during rollout. The app now accepts one invite at a time with accept_invite(). Drop in a follow-up.';

-- ── 5. Decline ──────────────────────────────────────────────────────────────

create function public.decline_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_updated integer;
begin
  if v_uid is null or p_invite_id is null then
    return false;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return false;
  end if;

  -- declined_by references user_profiles.
  perform public.ensure_my_profile();

  -- Only the caller's OWN open, unexpired invite, and only once: the true
  -- return is the single trigger for the decline mails.
  update public.invites
     set declined_at = now(), declined_by = v_uid
   where id = p_invite_id
     and accepted_at is null
     and declined_at is null
     and expires_at > now()
     and lower(email) = v_email;
  get diagnostics v_updated = row_count;

  return v_updated > 0;
end;
$$;

comment on function public.decline_invite(uuid) is
  'The invitee''s explicit decline of ONE open invite addressed to them. True only on the open -> declined transition (so mail is sent once); false otherwise. z8uq9m2yvp.';

-- What the decline mails need. service_role only: it hands out the INVITER'S
-- e-mail address, which the invitee must never be able to read. The caller (a
-- server action) passes only an id that decline_invite just returned true for.
create function public.declined_invite_mail_context(p_invite_id uuid)
returns table (
  inviter_email text,
  invitee_email text,
  company_name text,
  is_crew boolean,
  event_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select au.email::text, i.email, v.name, cardinality(i.roles) = 0, ev.name
  from public.invites i
  join public.venues v on v.id = i.venue_id
  left join auth.users au on au.id = i.invited_by
  left join public.events ev
    on cardinality(i.roles) = 0 and ev.id = i.event_ids[1] and ev.venue_id = i.venue_id
  where i.id = p_invite_id
    and i.declined_at is not null;
$$;

comment on function public.declined_invite_mail_context(uuid) is
  'Decline mails (service_role only): inviter e-mail, the e-mail address as typed on the invite, company name, whether it was a crew invite and, for crew, the event name, for a DECLINED invite only. z8uq9m2yvp.';

-- ── 6. Banner read: open invites only ───────────────────────────────────────

create or replace function public.my_pending_invites()
returns table (
  id uuid,
  company_name text,
  roles public.venue_role[],
  event_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, v.name, i.roles, ev.name, i.created_at
  from public.invites i
  join auth.users u on u.id = auth.uid()
  join public.venues v on v.id = i.venue_id
  left join public.events ev
    on cardinality(i.roles) = 0 and ev.id = i.event_ids[1] and ev.venue_id = i.venue_id
  where i.accepted_at is null
    and i.declined_at is null
    and i.expires_at > now()
    and lower(i.email) = lower(u.email)
    -- A crew invite to the caller's own company is a no-op on accept: don't show it.
    and not (
      cardinality(i.roles) = 0
      and exists (
        select 1 from public.venue_memberships m
        where m.venue_id = i.venue_id and m.user_id = auth.uid()
      )
    )
  order by i.created_at desc;
$$;

-- ── 7. Mail log: the two decline mail types ─────────────────────────────────

alter table public.mail_log drop constraint mail_log_type_check;
alter table public.mail_log
  add constraint mail_log_type_check
  check (type in (
    'team_join', 'team_added_to_event', 'team_resend', 'auth_invite',
    'team_invite_declined', 'team_invite_declined_confirm'
  ));

-- ── Function grants ─────────────────────────────────────────────────────────
-- (accept_pending_invites / accept_my_invites / my_pending_invites keep the
-- grants they already had; CREATE OR REPLACE preserves them.)
revoke execute on function public.ensure_my_profile() from public, anon;
revoke execute on function public.accept_invite_for_caller(uuid) from public, anon, authenticated;
revoke execute on function public.accept_invite(uuid) from public, anon;
revoke execute on function public.decline_invite(uuid) from public, anon;
revoke execute on function public.declined_invite_mail_context(uuid) from public, anon, authenticated;
grant execute on function public.ensure_my_profile() to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;
grant execute on function public.declined_invite_mail_context(uuid) to service_role;
