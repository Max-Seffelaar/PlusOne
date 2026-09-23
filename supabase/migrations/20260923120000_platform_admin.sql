-- P-02 — Platform (system) admin: is_platform_admin + RLS-helper widening.
--
-- Goal: PlusOne's own operators can read AND write in every venue to debug and
-- help, with every action traceable to their name. The boundary lives in RLS,
-- not in app code (CLAUDE.md #1).
--
-- Design decision (ClickUp z8uq9m0tnt): the capability is deliberately NOT a
-- value in `public.venue_role[]`. That array flows through `invites`,
-- `canGrantRoles` and ~59 policies — a superuser value inside it would turn
-- every venue admin into a potential superuser-granter. Instead:
--
--   * `user_profiles.is_platform_admin boolean not null default false`
--   * `public.is_platform_admin()` — stable, SECURITY DEFINER, search_path = ''
--   * `public.set_platform_admin(uuid, boolean)` — SECURITY DEFINER RPC that
--     requires `is_platform_admin()` itself and writes its own audit row
--   * a BEFORE INSERT/UPDATE guard on `user_profiles` so the column can only
--     ever change through that RPC — `user_profiles_insert_self` /
--     `user_profiles_update_self` let a user write their OWN row, which without
--     this guard is a one-request self-promotion to platform admin.
--
-- The four membership helpers plus `can_view_profile` get
-- `or public.is_platform_admin()`. Measured in prod: 68 policies in `public`,
-- 59 route through those helpers and 0 carry their own membership join, so
-- there is no policy-by-policy work here.
--
-- Audit: `public.audit_trigger()` already stamps `actor_id = auth.uid()`, so a
-- platform admin's writes to guests / quotas / event_quotas / guest_tiers /
-- check_ins / venue_memberships land in `audit_log` under their own id. Nothing
-- to change there — `supabase/tests/database/platform_admin.test.sql` proves it.
--
-- Bootstrap (no platform admin exists yet, so the RPC cannot be used). From a
-- superuser/SQL-editor session, inside one transaction:
--
--   begin;
--   set local plusone.platform_admin_write = 'on';
--   update public.user_profiles set is_platform_admin = true
--    where email = 'max@…';
--   commit;
--
-- Every later grant/revoke goes through public.set_platform_admin().

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column is_platform_admin boolean not null default false;

comment on column public.user_profiles.is_platform_admin is
  'PlusOne platform (system) admin: cross-venue read+write for support/debug. '
  'Deliberately NOT a venue_role value. Only writable through '
  'public.set_platform_admin(); public.guard_platform_admin_flag() rejects '
  'every other path, including a user updating their own profile row.';

-- ---------------------------------------------------------------------------
-- 2. Helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER like its sibling helpers: called from RLS on user_profiles
-- itself, so it must see the row past the caller's own visibility (and past the
-- can_view_profile policy that calls back into this function). The owner
-- bypasses RLS, which is what breaks the recursion.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.id = (select auth.uid())
      and p.is_platform_admin
  );
$$;

comment on function public.is_platform_admin() is
  'True when the calling session belongs to a PlusOne platform admin. Returns '
  'false for anon (auth.uid() is null) and for every ordinary venue user.';

revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Column guard — the flag is RPC-only
-- ---------------------------------------------------------------------------
-- RLS is row-level, not column-level: `user_profiles_update_self` already
-- allows a user to write their own row, and `user_profiles_insert_self` allows
-- them to create it. Without this trigger either one sets is_platform_admin in
-- a single PostgREST call. The transaction-local GUC is set ONLY by
-- set_platform_admin() (and by the documented bootstrap statement above);
-- PostgREST gives an API caller no way to set a GUC alongside their write.

create or replace function public.guard_platform_admin_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not new.is_platform_admin then
      return new;
    end if;
  elsif new.is_platform_admin is not distinct from old.is_platform_admin then
    return new;
  end if;

  if coalesce(current_setting('plusone.platform_admin_write', true), '') <> 'on' then
    raise exception
      'is_platform_admin can only be changed through public.set_platform_admin()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_platform_admin_flag() is
  'BEFORE INSERT/UPDATE guard on user_profiles.is_platform_admin: rejects any '
  'write to the column that does not come from public.set_platform_admin().';

create trigger guard_platform_admin_flag
  before insert or update on public.user_profiles
  for each row execute function public.guard_platform_admin_flag();

-- ---------------------------------------------------------------------------
-- 4. set_platform_admin — the one audited way in and out
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because it writes a column no app role may write and an
-- audit_log row no app role may insert. It re-checks is_platform_admin() itself
-- rather than trusting any caller-side gate.

create or replace function public.set_platform_admin(p_user_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old boolean;
begin
  if p_user_id is null or p_value is null then
    raise exception 'set_platform_admin requires a user id and a value'
      using errcode = '22023';
  end if;

  if not public.is_platform_admin() then
    -- Generic on purpose: the caller learns nothing about the target.
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select p.is_platform_admin into v_old
  from public.user_profiles p
  where p.id = p_user_id;

  if v_old is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_old = p_value then
    return; -- idempotent; nothing changed, nothing audited
  end if;

  if not p_value and p_user_id = v_actor then
    raise exception 'a platform admin cannot revoke their own access'
      using errcode = '42501';
  end if;

  perform set_config('plusone.platform_admin_write', 'on', true);
  update public.user_profiles
     set is_platform_admin = p_value
   where id = p_user_id;
  perform set_config('plusone.platform_admin_write', 'off', true);

  insert into public.audit_log
    (actor_id, venue_id, event_id, entity_type, entity_id, action, diff, device_id)
  values
    (v_actor, null, null, 'user_profiles', p_user_id,
     case when p_value then 'platform_admin_grant' else 'platform_admin_revoke' end,
     jsonb_build_object(
       'before', jsonb_build_object('is_platform_admin', v_old),
       'after',  jsonb_build_object('is_platform_admin', p_value)),
     public.request_device_id());
end;
$$;

comment on function public.set_platform_admin(uuid, boolean) is
  'Grant/revoke PlusOne platform-admin status. Requires the caller to be a '
  'platform admin; writes an audit_log entry (venue_id null, so only platform '
  'admins can read it back). Self-revoke is refused to avoid a lockout.';

revoke execute on function public.set_platform_admin(uuid, boolean) from public, anon;
grant execute on function public.set_platform_admin(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Widen the membership helpers
-- ---------------------------------------------------------------------------
-- Bodies are copied verbatim from 20260613120000 / 20260706100000 with a single
-- `or public.is_platform_admin()` added. Signatures, volatility, security and
-- search_path are unchanged, so the existing grants and every policy that calls
-- them stay exactly as they are.

create or replace function public.is_venue_member(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.venue_memberships m
    where m.venue_id = p_venue_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_venue_role(p_venue_id uuid, p_roles public.venue_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.venue_memberships m
    where m.venue_id = p_venue_id
      and m.user_id = auth.uid()
      and m.roles && p_roles
  );
$$;

create or replace function public.is_event_organizer(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.event_organizers eo
    where eo.event_id = p_event_id and eo.user_id = auth.uid()
  );
$$;

create or replace function public.is_venue_organizer(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.event_organizers eo
    join public.events e on e.id = eo.event_id
    where e.venue_id = p_venue_id
      and eo.user_id = (select auth.uid())
  );
$$;

-- `user_is_quota_exempt` takes the ADDER's id as a parameter instead of reading
-- auth.uid(), so the widening above does not reach it. Without this the write
-- half of the boundary is theatre: `guests_insert` pins `added_by` to the
-- caller, a platform admin holds no `quotas` row at a foreign venue, and
-- `user_event_quota` falls through to 0 — every cross-venue guest add would die
-- on `enforce_guest_quota` with 45001. Body copied from the CURRENT definition
-- (20260625120000 — venue admin only; organizers/external crew lost their
-- exemption in 86ey21vre and must keep it that way) with one branch added.
-- Still keyed on p_user_id, so it exempts the platform admin as an adder and
-- nobody else.

create or replace function public.user_is_quota_exempt(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.events e
      join public.venue_memberships m on m.venue_id = e.venue_id
      where e.id = p_event_id
        and m.user_id = p_user_id
        and m.roles && '{admin}'::public.venue_role[]
    )
    or exists (
      select 1 from public.user_profiles p
      where p.id = p_user_id and p.is_platform_admin
    );
$$;

-- Internal math stays internal (mirrors 20260625120000): CREATE OR REPLACE keeps
-- the existing ACL, but the intent is re-asserted so it is visible in the diff.
revoke execute on function public.user_is_quota_exempt(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or p_profile_id = auth.uid()
    or exists (
      select 1
      from public.venue_memberships a
      join public.venue_memberships b on b.venue_id = a.venue_id
      where a.user_id = auth.uid() and b.user_id = p_profile_id
    )
    or exists (
      select 1
      from public.event_organizers eo
      join public.events e on e.id = eo.event_id
      join public.venue_memberships m on m.venue_id = e.venue_id
      where (eo.user_id = p_profile_id and m.user_id = auth.uid())
         or (eo.user_id = auth.uid() and m.user_id = p_profile_id)
    )
    or exists (
      select 1
      from public.event_organizers a
      join public.event_organizers b on b.event_id = a.event_id
      where a.user_id = auth.uid() and b.user_id = p_profile_id
    );
$$;
