-- Onboarding A (z8uq9m2vg5): "Always free" through the platform invite (ADE,
-- decision Max 2026-10-06, #40(b)), plus the mail_log type for our own
-- company invite mail (decision Max 2026-10-08: the platform invite mail goes
-- through generateLink + Resend like team/crew since PR #430).
--
-- 1. platform_invites.comped boolean not null default false: the platform
--    admin ticks "Always free" on the invite. Set on INSERT only (the insert
--    policy already admits any column for a platform admin); the guard below
--    freezes it afterwards: revoke and re-invite to change it.
-- 2. platform_invites.comped_venue_id uuid: the company that used the comped
--    invite. Written ONLY by create_venue_with_owner (definer, current_user =
--    owner) and only null -> value, so one comped invite comps exactly one
--    company. An app role can't set it on insert (policy) or update (guard).
-- 3. create_venue_with_owner(): body = 20261008120000 with one change at the
--    subscription insert. If the CALLER's own auth e-mail has an open
--    (revoked_at null, not anonymized) comped invite that has not been used,
--    whose inviter is STILL a platform admin, the new company's subscription
--    starts as 'comped' (the same end state as set_venue_comped(venue, true):
--    status comped, trial_ends_at null), the invite is stamped with the venue,
--    and one audit_log row records the comped decision on the INVITER's name
--    (actor_id = invited_by, action 'comped', entity = the subscription). The
--    insert itself is audited by audit_subscriptions as usual (actor = the
--    caller, who created the company). Why not call set_venue_comped(): it
--    requires is_platform_admin() of auth.uid(), and the caller here is the
--    invitee; the authority is the inviter's earlier decision, recorded on the
--    invite row. Comped comes from platform_invites.comped only: never from
--    user metadata, the mail or any client input (the RPC takes no flag).
--    The webhook can't overwrite it: apply_stripe_subscription_update keeps a
--    comped status (20260706120000), unchanged here.
-- 4. mail_log type 'platform_invite' (our own company invite mail). It carries
--    no venue (the company does not exist yet), so it never counts against a
--    company's daily cap; the per-recipient 60 s window applies as for any
--    invite mail. The invite + resend budget stays consume_platform_invite_throttle.
--
-- Grant matrix: no new table. The table-level `grant select, insert, update
-- on platform_invites to authenticated` (20260923150000) covers the two new
-- columns; RLS keeps them platform-admin-only. create_venue_with_owner keeps
-- its grants (re-asserted below). Expand-only: the deployed app never sends
-- comped and keeps working.

-- ---------------------------------------------------------------------------
-- 1 + 2. Columns
-- ---------------------------------------------------------------------------

alter table public.platform_invites
  add column comped boolean not null default false,
  add column comped_venue_id uuid references public.venues (id) on delete restrict;

comment on column public.platform_invites.comped is
  'Platform admin chose "Always free" for this invite: the first company the '
  'invitee creates starts as comped (create_venue_with_owner). Set on insert, '
  'frozen afterwards.';
comment on column public.platform_invites.comped_venue_id is
  'The company that used this comped invite. Written only by '
  'create_venue_with_owner, once. One comped invite comps one company.';

alter policy platform_invites_insert on public.platform_invites
  with check (
    public.is_platform_admin()
    and invited_by = (select auth.uid())
    and revoked_at is null
    and revoked_by is null
    and anonymized_at is null
    and comped_venue_id is null
  );

-- Guard: body = 20261006120000 plus the two comped columns.
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
       or new.comped is distinct from old.comped
       or new.comped_venue_id is distinct from old.comped_venue_id then
      raise exception 'platform invites are anonymized by the retention job only'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at
     or new.comped is distinct from old.comped then
    raise exception 'platform_invites identity columns are immutable'
      using errcode = '42501';
  end if;

  -- comped_venue_id: only the owner (create_venue_with_owner, SECURITY
  -- DEFINER) writes it, only once, and only on a comped invite. Every
  -- PostgREST request runs as authenticated/anon, so a platform admin's direct
  -- update can never mark an invite used or point it at another company.
  if new.comped_venue_id is distinct from old.comped_venue_id then
    if current_user in ('authenticated', 'anon')
       or old.comped_venue_id is not null
       or not new.comped then
      raise exception 'comped_venue_id is set by create_venue_with_owner only'
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
  'created_at/comped, makes a revoke one-way, admits anonymization only from '
  'the retention job and comped_venue_id only from create_venue_with_owner '
  '(once); an anonymized row is frozen.';

revoke execute on function public.guard_platform_invite_update()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. create_venue_with_owner(): comped from the caller's platform invite
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

  -- Comped platform invite (z8uq9m2vg5): matched on the caller's OWN auth
  -- e-mail (read here, never passed in), open, unused, and only while the
  -- inviter is still a platform admin. FOR UPDATE: two parallel creates by the
  -- same invitee serialise, and the second sees comped_venue_id set.
  if v_email is not null then
    select pi.id, pi.invited_by
      into v_invite_id, v_inviter
    from public.platform_invites pi
    join public.user_profiles p
      on p.id = pi.invited_by
     and p.is_platform_admin
    where lower(pi.email) = v_email
      and pi.comped
      and pi.comped_venue_id is null
      and pi.revoked_at is null
      and pi.anonymized_at is null
    order by pi.created_at asc
    limit 1
    for update of pi;
  end if;

  -- Per-venue subscription (#40c, #32 revised 2026-10-06): one plan, Pro,
  -- starting as a 14-day trial, or comped when the invite above says so. The
  -- comped end state is set_venue_comped(venue, true)'s: status comped,
  -- trial_ends_at null. p_plan_id is ignored (kept for the deployed caller).
  -- comped is never client-settable.
  insert into public.subscriptions (venue_id, status, plan_id)
  values (
    v_venue_id,
    case when v_invite_id is not null then 'comped' else 'trialing' end::public.subscription_status,
    'pro'
  )
  on conflict (venue_id) do nothing
  returning id into v_sub_id;

  if v_invite_id is not null and v_sub_id is not null then
    update public.platform_invites pi
       set comped_venue_id = v_venue_id
     where pi.id = v_invite_id;

    -- The comped decision on the inviter's name (decision #4: written by
    -- Postgres, never by app code; precedent set_platform_admin).
    insert into public.audit_log
      (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
    values
      (v_inviter, v_venue_id, null, 'subscriptions', v_sub_id, 'comped',
       jsonb_build_object(
         'before', null,
         'after', jsonb_build_object('status', 'comped'),
         'source', 'platform_invite',
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
