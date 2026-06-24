-- Consent gate (#20/#40, ClickUp 86ey1khun follow-up): a user must accept the
-- Terms + Privacy Policy at (1) their first login and (2) when they create a new
-- company/venue. Both are recorded auditably (who/when/which version).
--
-- Storage:
--   * user_profiles.terms_accepted_at / terms_version  — the USER's personal
--     acceptance (first-login gate). Written by the user via the table-level
--     UPDATE grant + RLS user_profiles_update_self (decision #24: a user only
--     ever edits their own profile), so no extra RPC is needed.
--   * venues.terms_accepted_at / terms_accepted_by / terms_version — the COMPANY
--     acceptance captured at venue creation. Written inside create_venue_with_owner
--     (SECURITY DEFINER, runs as auth.uid()), so the consenting actor is recorded.
--
-- The accepted version mirrors src/lib/legal.ts TERMS_VERSION; bumping it there
-- re-prompts every user (the gate compares stored vs current version).

-- ---------------------------------------------------------------------------
-- Consent columns
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column terms_accepted_at timestamptz,
  add column terms_version text;

comment on column public.user_profiles.terms_accepted_at is
  'When the user accepted the Terms + Privacy Policy at first login (#20/#40). NULL = not yet accepted → the consent gate fires.';

alter table public.venues
  add column terms_accepted_at timestamptz,
  add column terms_accepted_by uuid,
  add column terms_version text;

comment on column public.venues.terms_accepted_by is
  'The user (auth.uid) who accepted the Terms + Privacy Policy when creating this venue (#40). Set by create_venue_with_owner.';

-- ---------------------------------------------------------------------------
-- create_venue_with_owner(): record the company consent at creation
-- ---------------------------------------------------------------------------
-- Re-created (not create-or-replace) to add p_terms_version: a wider arg list is
-- a new overload, which would make the existing named-arg call from the action
-- ambiguous. The previous 11-arg signature (20260623150000) is dropped first.
-- The original arg order is preserved, so positional pgTAP calls keep binding.

-- Drop every prior overload so exactly one create_venue_with_owner remains and a
-- positional call can never be ambiguous: the original 6-arg (20260615000000) and
-- the 11-arg (20260623150000). Both are idempotent no-ops once already replaced.
drop function if exists public.create_venue_with_owner(text, text, text, integer, text, boolean);
drop function if exists public.create_venue_with_owner(
  text, text, text, integer, text, boolean, text, text, text, text, boolean
);

create function public.create_venue_with_owner(
  p_name text,
  p_address text,
  p_venue_type text,
  p_retention_months integer,
  p_plan_id text default null,
  p_comped boolean default false,
  p_kvk_number text default null,
  p_vat_number text default null,
  p_finance_email text default null,
  p_city text default null,
  p_complete boolean default false,
  -- Legal consent (#40): the Terms+Privacy version the owner accepted at the
  -- venue-create step. NULL only for non-app callers (the app always sends it).
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

  -- Per-venue subscription (#40c). comped lets pilot venues run without billing.
  v_status := case when p_comped then 'comped' else 'trialing' end::public.subscription_status;
  insert into public.subscriptions (venue_id, status, plan_id)
  values (v_venue_id, v_status, p_plan_id)
  on conflict (venue_id) do nothing;

  return v_venue_id;
end;
$$;

-- Privileges — re-applied for the new signature (the dropped function took its
-- grants with it). Authenticated-only (#40a/#40b: never via the service-role).
revoke execute on function
  public.create_venue_with_owner(text, text, text, integer, text, boolean, text, text, text, text, boolean, text)
from public, anon;

grant execute on function
  public.create_venue_with_owner(text, text, text, integer, text, boolean, text, text, text, text, boolean, text)
to authenticated;
