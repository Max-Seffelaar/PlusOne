-- Security fix (ClickUp 86ey9e851, adversarial review S3): create_venue_with_owner
-- and set_venue_plan both took a client-supplied p_comped boolean and were
-- GRANT'ed to authenticated, so any logged-in user could call either RPC
-- directly (POST /rest/v1/rpc/...) and set their own venue's subscription to
-- 'comped' — a status apply_stripe_subscription_update (20260706120000/130000)
-- explicitly never overwrites with webhook state. That made a client-set comped
-- a permanent, unreconciled billing bypass.
--
-- Decision #32: comped is manual-only, set exclusively via the service-role SQL
-- runbook (docs/stripe-setup.md). No RPC reachable by `authenticated` should be
-- able to set it — so p_comped is removed from both signatures entirely rather
-- than re-gated; every RPC-created subscription now always starts 'trialing'.
--
-- Both functions are re-created (not create-or-replace) because dropping a
-- parameter is a new overload — the prior signature is dropped first so exactly
-- one of each remains and a named-arg call can never be ambiguous.

-- ---------------------------------------------------------------------------
-- create_venue_with_owner(): drop p_comped, always insert 'trialing'
-- ---------------------------------------------------------------------------

drop function if exists public.create_venue_with_owner(
  text, text, text, integer, text, boolean, text, text, text, text, boolean, text
);

create function public.create_venue_with_owner(
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
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_venue_id uuid;
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

  -- Per-venue subscription (#40c). comped is never client-settable (#32) — every
  -- RPC-created venue starts trialing; comped is stamped later, manually, via the
  -- service-role runbook (docs/stripe-setup.md).
  insert into public.subscriptions (venue_id, status, plan_id)
  values (v_venue_id, 'trialing', p_plan_id)
  on conflict (venue_id) do nothing;

  return v_venue_id;
end;
$$;

revoke execute on function
  public.create_venue_with_owner(text, text, text, integer, text, text, text, text, text, boolean, text)
from public, anon;

grant execute on function
  public.create_venue_with_owner(text, text, text, integer, text, text, text, text, text, boolean, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- set_venue_plan(): drop p_comped, always insert/keep 'trialing' for new rows
-- ---------------------------------------------------------------------------
-- Update-branch behaviour is unchanged: an existing paid/dunning status
-- (active/past_due/canceled) is never downgraded by this RPC.

drop function if exists public.set_venue_plan(uuid, text, boolean);

create function public.set_venue_plan(
  p_venue_id uuid,
  p_plan_id text
)
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

  insert into public.subscriptions as s (venue_id, status, plan_id)
  values (p_venue_id, 'trialing', p_plan_id)
  on conflict (venue_id) do update
    set plan_id = excluded.plan_id,
        status = case
          when s.status in ('active', 'past_due', 'canceled', 'comped') then s.status
          else excluded.status
        end,
        updated_at = now();
end;
$$;

revoke execute on function
  public.set_venue_plan(uuid, text)
from public, anon;

grant execute on function
  public.set_venue_plan(uuid, text)
to authenticated;
