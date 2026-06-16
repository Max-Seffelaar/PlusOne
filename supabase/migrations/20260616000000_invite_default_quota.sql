-- #4 — Quotum bij uitnodigen. An admin/user_manager can set a guest quota at
-- invite time; it lands as the new member's VENUE default quota when they accept.
--
-- Why store-then-apply: at invite time the invitee has an auth.users row but no
-- user_profile/membership yet (those are created on first-login acceptance), and
-- quotas.user_id references user_profiles — so the quota row cannot exist yet. We
-- park the desired number on the invite and accept_pending_invites() seeds the
-- quota once the profile + membership exist. Per-event tweaks stay in the #5 flow
-- (event_quotas); this only seeds the standing venue default (quotas.default_count).
--
-- Security is unchanged: the escalation guard + AAL2 were already enforced by
-- invites_insert when the invite (and thus the quota intent) was written; the
-- accept RPC stays SECURITY DEFINER and idempotent.

alter table public.invites
  add column if not exists default_quota integer
    check (default_quota is null or default_quota >= 0);

comment on column public.invites.default_quota is
  'Optional guest quota captured at invite time (#4). Seeded into quotas.default_count (venue default) on acceptance; null = nothing seeded.';

-- Extend the acceptance RPC to also seed the venue quota from the invite. Only
-- change vs the fase-4 version: select default_quota in the loop and, when set,
-- insert a quotas row (DO NOTHING on conflict, so a later admin adjustment is
-- never clobbered by re-accepting an old invite). CREATE OR REPLACE keeps the
-- function's existing grants + the revoke-from-public.
create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_full_name text;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    return 0;
  end if;

  select lower(u.email), coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email)
    into v_email, v_full_name
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    return 0;
  end if;

  -- Profile is owned by the user (decision #24); create it on first acceptance.
  insert into public.user_profiles (id, full_name, email)
  values (v_uid, v_full_name, v_email)
  on conflict (id) do nothing;

  for r in
    select i.id, i.venue_id, i.roles, i.default_quota
    from public.invites i
    where i.accepted_at is null
      and i.expires_at > now()
      and lower(i.email) = v_email
    for update
  loop
    insert into public.venue_memberships as vm (venue_id, user_id, roles)
    values (r.venue_id, v_uid, r.roles)
    on conflict (venue_id, user_id) do update
      set roles = (
        select array(
          select distinct e
          from unnest(vm.roles || excluded.roles) as e
        )::public.venue_role[]
      );

    -- #4: seed the venue default quota captured on the invite, once. DO NOTHING
    -- so re-accepting an old invite never overwrites a quota an admin has since
    -- adjusted (the invite seeds a quota, it does not manage it).
    if r.default_quota is not null then
      insert into public.quotas (venue_id, user_id, default_count)
      values (r.venue_id, v_uid, r.default_quota)
      on conflict (venue_id, user_id) do nothing;
    end if;

    update public.invites
      set accepted_at = now(), accepted_by = v_uid
      where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
