-- Wire "New venue" creation from the in-app venue switcher (ClickUp 86ey1khun).
--
-- The po VenueCreate screen (settings → Switch venue → New venue) collects more
-- than the onboarding wizard's first step does: besides name + venue-type +
-- retention it also captures the company/billing fields city, KvK, BTW (VAT) and
-- the billing e-mail. The onboarding flow sets those later in Venue Settings, but
-- a switcher quick-create is a one-shot — so create_venue_with_owner is extended
-- to persist them in the SAME transaction (venue + admin membership + trialing
-- subscription stay atomic, #40a/#40c). No new write path, no service-role: still
-- the SECURITY DEFINER RPC running as auth.uid(), so RLS + the audit-actor
-- attribution are unchanged.
--
-- Two switcher-specific needs drive the extra p_complete flag:
--   * /app redirects to /onboarding whenever getOnboardingState() != 'done'
--     (src/app/app/page.tsx). A venue left in-onboarding would bounce the owner
--     into the wizard after the post-create reload instead of landing them IN the
--     new venue. p_complete=true stamps settings.onboarding.completed=true so the
--     venue is immediately a normal, usable one.
--   * The double-submit/resume guard exists for the resumable wizard (one
--     in-onboarding venue per fresh owner). An established multi-venue user adding
--     another venue must always get a NEW venue, so p_complete=true skips it.
-- The onboarding wizard keeps calling with p_complete defaulted to false, so its
-- behaviour is untouched.
--
-- The arg list grows, so the function must be dropped + recreated (a wider arg
-- list is a new overload under create-or-replace, which would make the existing
-- 4-named-arg call from the action ambiguous). The original 6 params keep their
-- order, so the positional pgTAP calls still bind correctly.

drop function if exists public.create_venue_with_owner(text, text, text, integer, text, boolean);

create function public.create_venue_with_owner(
  p_name text,
  p_address text,
  p_venue_type text,
  p_retention_months integer,
  -- Plan is picked in the next onboarding step, so it may be null at creation;
  -- set_venue_plan fills it in. The subscription row still starts as trialing.
  p_plan_id text default null,
  p_comped boolean default false,
  -- Company / billing profile (optional) — only the switcher quick-create sends
  -- these; the onboarding wizard leaves them null and they are set later in
  -- Venue Settings.
  p_kvk_number text default null,
  p_vat_number text default null,
  p_finance_email text default null,
  p_city text default null,
  -- When true (switcher quick-create): create a ready-to-use venue — skip the
  -- in-onboarding resume guard and stamp onboarding.completed=true.
  p_complete boolean default false
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
    kvk_number, vat_number, finance_email, city
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
    nullif(btrim(coalesce(p_city, '')), '')
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
-- grants with it). Self-service venue creation is an authenticated-user action
-- (#40a/#40b: never via the service-role).
revoke execute on function
  public.create_venue_with_owner(text, text, text, integer, text, boolean, text, text, text, text, boolean)
from public, anon;

grant execute on function
  public.create_venue_with_owner(text, text, text, integer, text, boolean, text, text, text, text, boolean)
to authenticated;
