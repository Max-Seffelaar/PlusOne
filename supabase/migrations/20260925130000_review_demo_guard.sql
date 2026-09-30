-- Store-review demo guard (Fase 17 S3, ClickUp 86ey6bfug, PR #332 round 2).
--
-- The demo account behind /auth/review-login (fixed auth user id
-- de300000-0000-7000-8000-00000000a001 = DEMO_USER_ID in
-- src/features/auth/review-window.ts and scripts/seed-demo-venue.mjs) is
-- reachable by anyone holding the per-submission review code. Through
-- create_venue_with_owner it could create a venue of its own, invite a real
-- address as admin there and then delete its own membership: the review login's
-- membership count is back to one, and a stranger owns a real tenant on an
-- invite-only prod. The route and the seed can only DETECT that; this closes it.
--
-- Change: exactly one added guard. create or replace of the LATEST definition
-- (20260713180000_remove_client_comped.sql): same 11-argument signature, same
-- security definer, same pinned search_path = '', same body otherwise.
-- create or replace keeps the function's owner and ACL, so the grant matrix
-- (execute: authenticated only; revoked from public, anon) is unchanged and is
-- asserted by supabase/tests/database/review_demo_guard.test.sql.
--
-- If the demo account ever needs another id, this constant moves with it (a new
-- migration, never an edit of this one).

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

  -- Per-venue subscription (#40c). comped is never client-settable (#32) — every
  -- RPC-created venue starts trialing; comped is stamped later, manually, via the
  -- service-role runbook (docs/stripe-setup.md).
  insert into public.subscriptions (venue_id, status, plan_id)
  values (v_venue_id, 'trialing', p_plan_id)
  on conflict (venue_id) do nothing;

  return v_venue_id;
end;
$$;
