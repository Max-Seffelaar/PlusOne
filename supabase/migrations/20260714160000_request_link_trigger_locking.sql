-- Fix (86ey9p8zh, follow-up to 86ey9e8ar/PR #216) — enforce_request_link_max()
-- had no concurrency serialisation, the exact same gap the three domains in
-- 20260714100000_quota_capacity_trigger_locking.sql just fixed.
--
-- enforce_request_link_max() (20260706101000_request_link_attribution.sql)
-- recomputes request_link_consumption() with a plain SELECT in an AFTER trigger
-- under READ COMMITTED, with no row lock. Two concurrent adds through the same
-- request link (two door sessions, or two offline-outbox replays attributing to
-- the same influencer link) each snapshot the pre-insert count, neither sees the
-- other's uncommitted row, both pass, and max_headcount is silently exceeded —
-- the same fraud-critical gap (#5) as personal quota/tier-max/event capacity.
--
-- Fix: take a pg_advisory_xact_lock keyed on the request_link_id BEFORE the
-- recompute, only on the branch that can actually breach the cap (a net
-- INCREASE) — same short-circuit the function already had. This is the fourth
-- contention domain (1=personal quota, 2=tier max, 3=event capacity, all in
-- 20260714100000); domain 4 = request link, keyed on request_link_id, so it can
-- never collide with the other three's advisory-lock slots.

create or replace function public.enforce_request_link_max()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_is_inside boolean;
  v_old int := 0;
  v_new int;
  v_total int;
begin
  if new.request_link_id is null then
    return null;
  end if;

  select rl.max_headcount into v_max
  from public.request_links rl where rl.id = new.request_link_id;
  if v_max is null then
    return null;                       -- uncapped link
  end if;

  v_is_inside := exists (
    select 1 from public.check_ins ci
    where ci.guest_id = new.id and ci.voided_at is null
  );

  v_new := public.link_headcount_contribution(new, v_is_inside);
  if tg_op = 'UPDATE' and old.request_link_id = new.request_link_id then
    v_old := public.link_headcount_contribution(old, v_is_inside);
  end if;

  -- Only a net increase can breach the cap.
  if v_new > v_old then
    -- Serialise concurrent adds into this same request link: block until any
    -- other in-flight add for this link has committed/rolled back, so the
    -- recompute below always sees the true prior state.
    perform pg_advisory_xact_lock(4, hashtext(new.request_link_id::text));

    v_total := public.request_link_consumption(new.request_link_id);
    if v_total > v_max then
      raise exception using
        errcode = '45006',
        message = format('Deze aanvraaglink zit vol: %s van %s plekken bezet.', v_total, v_max),
        hint = format('link_full;consumed=%s;max=%s', v_total, v_max);
    end if;
  end if;
  return null;
end;
$$;

-- CREATE OR REPLACE preserves existing grants; already revoked from
-- public/anon/authenticated/service_role (20260706101000) and stays that way —
-- internal trigger function only.
