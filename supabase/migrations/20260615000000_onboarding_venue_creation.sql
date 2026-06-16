-- Onboarding & self-service venue-creatie (spec #40a/#40c).
--
-- A brand-new owner is provisioned invite-only (account-creatie blijft
-- invite-only, #3/#20), logs in via OTP, and has ZERO venue memberships. The
-- onboarding flow then lets them create their first venue/company themselves:
-- after creation the user is automatically Admin of that venue (#40a), and the
-- venue gets its own subscriptions-record (#40c — comped for pilots, otherwise
-- trialing; the definitive billing status lands with the billing-fase #32).
--
-- Why RPCs and not the service-role client (mirrors accept_pending_invites in
-- 20260613190000_auth_invites_sessions.sql):
--   * SECURITY DEFINER runs as the function owner (so it may INSERT a venue —
--     venues has no authenticated INSERT policy — and a venue_membership, which
--     RLS otherwise allows only to an existing admin), yet auth.uid() still
--     resolves to the logged-in owner. That makes the audit_venue_memberships
--     trigger attribute the ownership grant to the real actor, which a raw
--     service-role connection (no auth.uid()) could never do.
--   * The whole create is one transaction: venue + membership + subscription
--     commit together, so a venue can never be stranded without an admin.
-- subscriptions has only a SELECT policy for authenticated, so the plan + the
-- completion flag are written through these definer RPCs too — the
-- "Stripe/webhook writes only" invariant (#32) stays intact.

-- ---------------------------------------------------------------------------
-- Helper: a venue slug that is unique across ALL venues
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the uniqueness probe sees every venue (RLS would hide
-- venues the caller is not a member of). Only ever called from
-- create_venue_with_owner, so it is not granted to any client role.

create or replace function public.unique_venue_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := coalesce(nullif(public.slugify(p_name), ''), 'venue');
  v_slug text := v_base;
begin
  while exists (select 1 from public.venues where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  end loop;
  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_venue_with_owner(): self-service venue creation (#40a)
-- ---------------------------------------------------------------------------
-- Runs as the logged-in user (auth.uid()). Idempotent + resumable: a
-- double-submit (or a retried request) returns the owner's existing
-- still-in-onboarding venue instead of spawning a duplicate. address +
-- venue_type are display data and live in venues.settings (no columns).

create or replace function public.create_venue_with_owner(
  p_name text,
  p_address text,
  p_venue_type text,
  p_retention_months integer,
  -- Plan is picked in the next onboarding step, so it may be null at creation;
  -- set_venue_plan fills it in. The subscription row still starts as trialing.
  p_plan_id text default null,
  p_comped boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_venue_id uuid;
  v_status public.subscription_status;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Defense in depth next to the Zod schema in the action.
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'venue name required' using errcode = '23514';
  end if;
  if p_retention_months is null or p_retention_months < 1 or p_retention_months > 60 then
    raise exception 'retention_months out of range' using errcode = '23514';
  end if;

  -- Double-submit / resume guard: if the owner already has an Admin venue that
  -- has not finished onboarding, return it rather than create a second one.
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

  insert into public.venues (name, slug, retention_months, settings)
  values (
    btrim(p_name),
    public.unique_venue_slug(p_name),
    p_retention_months,
    jsonb_build_object(
      'address', nullif(btrim(coalesce(p_address, '')), ''),
      'venue_type', p_venue_type,
      'onboarding', jsonb_build_object('completed', false, 'created_by', v_uid)
    )
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

  -- Per-venue subscription (#40c). comped lets pilot venues run without billing.
  v_status := case when p_comped then 'comped' else 'trialing' end::public.subscription_status;
  insert into public.subscriptions (venue_id, status, plan_id)
  values (v_venue_id, v_status, p_plan_id)
  on conflict (venue_id) do nothing;

  return v_venue_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_venue_plan(): set/replace the plan on the resumable onboarding path (#40c)
-- ---------------------------------------------------------------------------
-- Used when a venue exists but the subscription is missing or the plan changed
-- before onboarding completes. Admin-only; never downgrades a paid status that
-- a future Stripe webhook may have set.

create or replace function public.set_venue_plan(
  p_venue_id uuid,
  p_plan_id text,
  p_comped boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.subscription_status;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_venue_role(p_venue_id, '{admin}'::public.venue_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_status := case when p_comped then 'comped' else 'trialing' end::public.subscription_status;

  insert into public.subscriptions as s (venue_id, status, plan_id)
  values (p_venue_id, v_status, p_plan_id)
  on conflict (venue_id) do update
    set plan_id = excluded.plan_id,
        status = case
          when s.status in ('active', 'past_due', 'canceled') then s.status
          else excluded.status
        end,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_onboarding_complete(): flip venues.settings.onboarding.completed (#40d)
-- ---------------------------------------------------------------------------
-- Admin-only. Shallow-merges so other settings/onboarding keys are preserved.

create or replace function public.mark_onboarding_complete(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.has_venue_role(p_venue_id, '{admin}'::public.venue_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.venues
    set settings = coalesce(settings, '{}'::jsonb)
                   || jsonb_build_object(
                        'onboarding',
                        coalesce(settings -> 'onboarding', '{}'::jsonb)
                          || jsonb_build_object('completed', true)
                      )
    where id = p_venue_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges — explicit (fase-1 pattern: grant nothing by default locally).
-- ---------------------------------------------------------------------------

revoke execute on function
  public.unique_venue_slug(text),
  public.create_venue_with_owner(text, text, text, integer, text, boolean),
  public.set_venue_plan(uuid, text, boolean),
  public.mark_onboarding_complete(uuid)
from public, anon;

-- Self-service venue creation is an authenticated-user action (#40a/#40b: never
-- via the service-role). unique_venue_slug stays internal to the definer above.
grant execute on function
  public.create_venue_with_owner(text, text, text, integer, text, boolean),
  public.set_venue_plan(uuid, text, boolean),
  public.mark_onboarding_complete(uuid)
to authenticated;
