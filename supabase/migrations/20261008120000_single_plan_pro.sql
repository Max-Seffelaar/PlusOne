-- Billing G (ClickUp z8uq9m2vrz, decision #32 revised 2026-10-06): ONE plan, Pro.
--
-- Indie / Premium / "Pro on request" are gone. Every company runs on Pro: a
-- 14-day trial, then monthly or yearly through Stripe (prices live in Stripe
-- under the lookup keys pro_monthly / pro_yearly, never here or in code).
--
-- 1. Data: every subscription row gets plan_id = 'pro'. Legacy values
--    (indie, premium, pilot, basic, null) carry no behaviour anywhere — the
--    gate reads status + trial dates, never the plan — so this is a relabel,
--    audited row by row by the existing audit_subscriptions trigger
--    (actor null = migration). supabase/seed.sql still inserts 'pilot'/'basic'
--    after this runs; the app shows any subscription as Pro.
-- 2. create_venue_with_owner(): the new company's subscription always starts
--    as trialing Pro. p_plan_id stays in the signature (expand–contract: the
--    deployed app still sends it by name) but is ignored. That also retires the
--    onboarding 'plan' step: a company created by the RPC already has its plan,
--    so getOnboardingState goes venue → team.
-- 3. set_venue_plan(): stays (the deployed wizard still calls it until this
--    release ships). It accepts the deployed wizard's ids 'indie', 'premium'
--    and 'pro' and always stores 'pro'; anything else raises 22023. Narrowing
--    it to 'pro' (or dropping it) is a later contract migration.
--    Same admin check and same "never downgrade a paid/dunning/comped status"
--    rule as 20260713180000. No new overload: create or replace on the exact
--    (uuid, text) signature, so exactly one set_venue_plan exists.
--
-- No new table or column, so no grant-matrix entry; the two functions keep
-- their grants (re-asserted below so this file stands alone).

update public.subscriptions
set plan_id = 'pro'
where plan_id is distinct from 'pro';

-- ---------------------------------------------------------------------------
-- create_venue_with_owner(): subscription always trialing Pro
-- ---------------------------------------------------------------------------
-- Body copied from the live definition (20260925130000_review_demo_guard) with
-- only the subscriptions insert changed.

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

  -- Per-venue subscription (#40c, #32 revised 2026-10-06): one plan, Pro, always
  -- starting as a 14-day trial. p_plan_id is ignored (kept for the deployed
  -- caller). comped is never client-settable — a platform admin sets it through
  -- set_venue_comped() (20261008120200).
  insert into public.subscriptions (venue_id, status, plan_id)
  values (v_venue_id, 'trialing', 'pro')
  on conflict (venue_id) do nothing;

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
-- set_venue_plan(): only 'pro'
-- ---------------------------------------------------------------------------

create or replace function public.set_venue_plan(
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
  -- Expand–contract: the wizard deployed before Billing G still sends its
  -- legacy ids ('premium' by default, or 'indie'). Accept them and store Pro,
  -- so "db push before the app is promoted" (or an app rollback) never blocks
  -- onboarding. Contract to 'pro'-only in a later migration, once no deployed
  -- app calls this with a legacy id.
  if p_plan_id is null or p_plan_id not in ('indie', 'premium', 'pro') then
    raise exception 'unknown plan' using errcode = '22023';
  end if;

  insert into public.subscriptions as s (venue_id, status, plan_id)
  values (p_venue_id, 'trialing', 'pro')
  on conflict (venue_id) do update
    set plan_id = excluded.plan_id,
        status = case
          when s.status in ('active', 'past_due', 'canceled', 'comped') then s.status
          else excluded.status
        end,
        updated_at = now();
end;
$$;

revoke execute on function public.set_venue_plan(uuid, text) from public, anon;
grant execute on function public.set_venue_plan(uuid, text) to authenticated;
