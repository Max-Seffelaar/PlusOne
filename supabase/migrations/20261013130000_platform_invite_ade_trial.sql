-- Onboarding A (z8uq9m2vg5): "Free until end of ADE" through the platform
-- invite (decision Max 2026-10-08, replacing the earlier "Always free via the
-- invite"), plus the mail_log type for our own company invite mail (decision
-- Max 2026-10-08: the platform invite mail goes through generateLink + Resend
-- like team/crew since PR #430).
--
-- ADE 2026 runs 21-25 October; free means "through Monday 26 October", so the
-- trial ends at 2026-10-27 00:00 Europe/Amsterdam. That date lives in exactly
-- one place in the database: ADE_TRIAL_END in create_venue_with_owner below.
--
-- 1. platform_invites.free_until_ade boolean not null default false: the
--    platform admin ticks it on the invite. Set on INSERT only (the insert
--    policy admits any column for a platform admin); the guard freezes it.
-- 2. platform_invites.ade_trial_venue_id uuid: the company that used the
--    invite. Written ONLY by create_venue_with_owner (definer, current_user =
--    owner) and only null -> value, so one invite extends exactly one trial.
--    An app role can't set it on insert (policy) or update (guard).
-- 3. create_venue_with_owner(): body = 20261008120000 with one change at the
--    subscription insert. If the CALLER's own auth e-mail has an open
--    (revoked_at null, not anonymized) free_until_ade invite that has not
--    been used, whose inviter is STILL a platform admin, the company's
--    subscription starts as an ordinary 'trialing' Pro with
--    trial_ends_at = greatest(ADE_TRIAL_END, now() + 14 days): never shorter
--    than the normal trial, and after ADE it is simply the normal 14 days.
--    The invite is stamped with the venue, and one audit_log row records the
--    trial end on the INVITER's name (action 'update' on the subscription, the
--    shape set_venue_trial_end leaves through audit_subscriptions). The insert
--    itself is audited as usual on the caller. Nothing here sets 'comped':
--    "Always free" stays the Platform tab's set_venue_comped only. The flag is
--    read from platform_invites only: never from user metadata, the mail or
--    any client input (the RPC takes no flag). Stripe Checkout carries the
--    trial end over (effectiveTrialEndsAt, Billing G).
-- 4. mail_log type 'platform_invite' (our own company invite mail). It carries
--    no venue (the company does not exist yet), so it never counts against a
--    company's daily cap; the per-recipient 60 s window applies as for any
--    invite mail. The invite + resend budget stays consume_platform_invite_throttle.
--
-- After ADE this option is dead weight: a follow-up (expand-contract) drops
-- the column and the branch once no deployed code sends it.
--
-- Grant matrix: no new table. The table-level `grant select, insert, update
-- on platform_invites to authenticated` (20260923150000) covers the two new
-- columns; RLS keeps them platform-admin-only. create_venue_with_owner keeps
-- its grants (re-asserted below). Expand-only: the deployed app never sends
-- free_until_ade and keeps working.

-- ---------------------------------------------------------------------------
-- 1 + 2. Columns
-- ---------------------------------------------------------------------------

alter table public.platform_invites
  add column free_until_ade boolean not null default false,
  add column ade_trial_venue_id uuid references public.venues (id) on delete restrict;

comment on column public.platform_invites.free_until_ade is
  'Platform admin chose "Free until end of ADE" for this invite: the first '
  'company the invitee creates gets a trial until the ADE date in '
  'create_venue_with_owner (never shorter than 14 days). Set on insert, frozen '
  'afterwards. Drop after ADE (expand-contract).';
comment on column public.platform_invites.ade_trial_venue_id is
  'The company that used this free_until_ade invite. Written only by '
  'create_venue_with_owner, once. One invite extends one trial.';

alter policy platform_invites_insert on public.platform_invites
  with check (
    public.is_platform_admin()
    and invited_by = (select auth.uid())
    and revoked_at is null
    and revoked_by is null
    and anonymized_at is null
    and ade_trial_venue_id is null
  );

-- Guard: body = 20261006120000 plus the two ADE columns.
create or replace function public.guard_platform_invite_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is not null then
    raise exception 'an anonymized platform invite cannot be changed'
      using errcode = '42501';
  end if;

  if new.anonymized_at is not null then
    if current_user in ('authenticated', 'anon')
       or new.email is not null
       or new.note is not null
       or new.id is distinct from old.id
       or new.invited_by is distinct from old.invited_by
       or new.created_at is distinct from old.created_at
       or new.last_sent_at is distinct from old.last_sent_at
       or new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by
       or new.free_until_ade is distinct from old.free_until_ade
       or new.ade_trial_venue_id is distinct from old.ade_trial_venue_id then
      raise exception 'platform invites are anonymized by the retention job only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at
     or new.free_until_ade is distinct from old.free_until_ade then
    raise exception 'platform_invites identity columns are immutable'
      using errcode = '42501';
  end if;

  -- ade_trial_venue_id: only the owner (create_venue_with_owner, SECURITY
  -- DEFINER) writes it, only once, and only on a free_until_ade invite. Every
  -- PostgREST request runs as authenticated/anon, so a platform admin's direct
  -- update can never mark an invite used or point it at another company.
  if new.ade_trial_venue_id is distinct from old.ade_trial_venue_id then
    if current_user in ('authenticated', 'anon')
       or old.ade_trial_venue_id is not null
       or not new.free_until_ade then
      raise exception 'ade_trial_venue_id is set by create_venue_with_owner only'
        using errcode = '42501';
    end if;
  end if;

  -- A revoke is one-way, its attribution is final, and the row becomes a
  -- point-in-time record (20260923150000).
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at
          or new.revoked_by is distinct from old.revoked_by
          or new.note is distinct from old.note) then
    raise exception 'a revoked platform invite cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_platform_invite_update() is
  'BEFORE UPDATE guard on platform_invites: freezes id/email/invited_by/'
  'created_at/free_until_ade, makes a revoke one-way, admits anonymization '
  'only from the retention job and ade_trial_venue_id only from '
  'create_venue_with_owner '
  '(once); an anonymized row is frozen.';

revoke execute on function public.guard_platform_invite_update()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. create_venue_with_owner(): ADE trial from the caller's platform invite
-- ---------------------------------------------------------------------------

create or replace function public.create_venue_with_owner(
  p_name text,
  p_address text,
  p_venue_type text,
  p_retention_months integer,
  p_plan_id text default null,
  p_kvk_number text default null,
  p_vat_number text default null,
  p_finance_email text default null,
  p_city text default null,
  p_complete boolean default false,
  p_terms_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_venue_id uuid;
  v_invite_id uuid;
  v_inviter uuid;
  v_sub_id uuid;
  v_trial_end timestamptz;
  -- ADE_TRIAL_END: "free until the end of ADE" (ADE 2026 = 21-25 Oct; free
  -- through Monday 26 Oct, decision Max 2026-10-08). The one place this date
  -- lives in the database.
  c_ade_trial_end constant timestamptz := timestamptz '2026-10-27 00:00:00 Europe/Amsterdam';
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Store-review demo account (86ey6bfug): never a venue creator. A code holder
  -- could otherwise create a venue, invite a real address as admin and drop
  -- their own membership, leaving a permanent tenant on invite-only prod.
  -- Same fixed id as DEMO_USER_ID (src/features/auth/review-window.ts).
  if v_uid = 'de300000-0000-7000-8000-00000000a001'::uuid then
    raise exception 'this account cannot create venues' using errcode = '42501';
  end if;

  -- Defense in depth next to the Zod schema in the action.
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'venue name required' using errcode = '23514';
  end if;
  if p_retention_months is null or p_retention_months < 1 or p_retention_months > 60 then
    raise exception 'retention_months out of range' using errcode = '23514';
  end if;

  -- Double-submit / resume guard (wizard only): if the owner already has an Admin
  -- venue that has not finished onboarding, return it rather than create a second
  -- one. A switcher quick-create (p_complete) always makes a fresh venue.
  if not p_complete then
    select v.id into v_venue_id
    from public.venues v
    join public.venue_memberships m
      on m.venue_id = v.id
     and m.user_id = v_uid
     and m.roles @> '{admin}'::public.venue_role[]
    where coalesce((v.settings #>> '{onboarding,completed}')::boolean, false) = false
    order by v.created_at asc
    limit 1;

    if v_venue_id is not null then
      return v_venue_id;
    end if;
  end if;

  -- Profile is owned by the user (#24); ensure it exists for the FK. A minted
  -- owner already gets one from accept_pending_invites on first login, so this
  -- is normally a no-op (mirrors that RPC).
  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email)
    into v_email, v_full_name
  from auth.users u
  where u.id = v_uid;

  insert into public.user_profiles (id, full_name, email)
  values (v_uid, coalesce(v_full_name, v_email, 'Gebruiker'), v_email)
  on conflict (id) do nothing;

  insert into public.venues (
    name, slug, retention_months, settings,
    kvk_number, vat_number, finance_email, city,
    terms_accepted_at, terms_accepted_by, terms_version
  )
  values (
    btrim(p_name),
    public.unique_venue_slug(p_name),
    p_retention_months,
    jsonb_build_object(
      'address', nullif(btrim(coalesce(p_address, '')), ''),
      'venue_type', p_venue_type,
      'onboarding', jsonb_build_object('completed', p_complete, 'created_by', v_uid)
    ),
    nullif(btrim(coalesce(p_kvk_number, '')), ''),
    nullif(btrim(coalesce(p_vat_number, '')), ''),
    nullif(lower(btrim(coalesce(p_finance_email, ''))), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    case when nullif(btrim(coalesce(p_terms_version, '')), '') is not null then now() end,
    case when nullif(btrim(coalesce(p_terms_version, '')), '') is not null then v_uid end,
    nullif(btrim(coalesce(p_terms_version, '')), '')
  )
  returning id into v_venue_id;

  -- Creator becomes Admin (#40a). on conflict keeps it idempotent if the resume
  -- guard ever races; merges roles like accept_pending_invites.
  insert into public.venue_memberships as vm (venue_id, user_id, roles)
  values (v_venue_id, v_uid, '{admin}'::public.venue_role[])
  on conflict (venue_id, user_id) do update
    set roles = (
      select array(
        select distinct e from unnest(vm.roles || excluded.roles) as e
      )::public.venue_role[]
    );

  -- ADE platform invite (z8uq9m2vg5): matched on the caller's OWN auth
  -- e-mail (read here, never passed in), open, unused, and only while the
  -- inviter is still a platform admin. FOR UPDATE: two parallel creates by the
  -- same invitee serialise, and the second sees ade_trial_venue_id set.
  if v_email is not null then
    select pi.id, pi.invited_by
      into v_invite_id, v_inviter
    from public.platform_invites pi
    join public.user_profiles p
      on p.id = pi.invited_by
     and p.is_platform_admin
    where lower(pi.email) = v_email
      and pi.free_until_ade
      and pi.ade_trial_venue_id is null
      and pi.revoked_at is null
      and pi.anonymized_at is null
    order by pi.created_at asc
    limit 1
    for update of pi;
  end if;

  -- Per-venue subscription (#40c, #32 revised 2026-10-06): one plan, Pro,
  -- always starting as a trial. Without an invite trial_ends_at stays null
  -- (= created_at + 14 days); with the ADE invite above it is the later of
  -- the ADE date and the normal 14 days. p_plan_id is ignored (kept for the
  -- deployed caller). Neither comped nor the trial end is client-settable.
  if v_invite_id is not null then
    v_trial_end := greatest(c_ade_trial_end, now() + interval '14 days');
  end if;

  insert into public.subscriptions (venue_id, status, plan_id, trial_ends_at)
  values (v_venue_id, 'trialing', 'pro', v_trial_end)
  on conflict (venue_id) do nothing
  returning id into v_sub_id;

  if v_invite_id is not null and v_sub_id is not null then
    update public.platform_invites pi
       set ade_trial_venue_id = v_venue_id
     where pi.id = v_invite_id;

    -- The trial end on the inviter's name, in the shape set_venue_trial_end
    -- leaves (an 'update' of the subscription's trial_ends_at), decision #4:
    -- written by Postgres, never by app code; precedent set_platform_admin.
    insert into public.audit_log
      (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
    values
      (v_inviter, v_venue_id, null, 'subscriptions', v_sub_id, 'update',
       jsonb_build_object(
         'before', jsonb_build_object('trial_ends_at', null),
         'after', jsonb_build_object('trial_ends_at', v_trial_end),
         'source', 'platform_invite_ade',
         'platform_invite_id', v_invite_id),
       public.request_device_id());
  end if;

  return v_venue_id;
end;
$function$;

revoke execute on function
  public.create_venue_with_owner(text, text, text, integer, text, text, text, text, text, boolean, text)
from public, anon;

grant execute on function
  public.create_venue_with_owner(text, text, text, integer, text, text, text, text, text, boolean, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- 4. mail_log: our own company invite mail
-- ---------------------------------------------------------------------------

alter table public.mail_log drop constraint mail_log_type_check;
alter table public.mail_log
  add constraint mail_log_type_check
  check (type in (
    'team_join', 'team_added_to_event', 'team_resend', 'auth_invite',
    'team_invite_declined', 'team_invite_declined_confirm',
    'platform_invite'
  ));
