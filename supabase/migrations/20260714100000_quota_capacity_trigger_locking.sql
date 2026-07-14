-- Fix (gap-sweep SW2, ClickUp 86ey9e8ar) — quota/capacity/tier-max triggers had no
-- concurrency serialisation.
--
-- enforce_guest_quota() and enforce_event_capacity() (20260624200000 /
-- 20260624090000) recompute consumption with a plain SELECT in an AFTER trigger
-- under READ COMMITTED, with no row lock anywhere in the migration set. Two
-- concurrent adds on the same quota/capacity/tier boundary (two door sessions, or
-- two offline-outbox replays) each snapshot the pre-insert count, neither sees the
-- other's uncommitted row, both pass, and the limit is silently exceeded — a
-- fraud-critical gap (#5).
--
-- Fix: take a pg_advisory_xact_lock keyed on the contended resource BEFORE the
-- recompute, but only on the branch that can actually breach a limit (a net
-- INCREASE) — mirrors the existing "only a net increase can breach" short-circuit,
-- so removals/decreases never serialise against each other. The lock is
-- transaction-scoped: a second inserter blocks until the first commits or rolls
-- back, then re-reads under a fresh READ COMMITTED snapshot that includes the
-- first's outcome, so at most one of two boundary-racing inserts can succeed.
--
-- Three independent contention domains, each with its own key so a collision in one
-- can never fight over the same advisory-lock slot as another:
--   1 = personal quota, keyed on (event_id, added_by) — a race only matters between
--       two adds by the SAME user on the SAME event.
--   2 = tier max, keyed on tier_id.
--   3 = event capacity, keyed on event_id.
-- The two-argument pg_advisory_xact_lock(int4, int4) form is used specifically so
-- the domain tag and the hashed key can never collide across domains (hashtext
-- collisions within one domain are harmless — they only cause extra, still-correct,
-- serialisation, never a missed one).

create or replace function public.enforce_guest_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_inside boolean;
  v_old_personal int := 0;
  v_new_personal int := 0;
  v_quota int;
  v_consumed int;
  v_tier_max int;
  v_old_tier int := 0;
  v_new_tier int := 0;
  v_tier_count int;
begin
  v_is_inside := exists (
    select 1 from public.check_ins ci
    where ci.guest_id = new.id and ci.voided_at is null
  );

  -- ---- personal quota (non-exempt adders only; landing/permanent never count) ----
  if new.source not in ('landing', 'permanent')
     and not public.user_is_quota_exempt(new.event_id, new.added_by) then

    v_new_personal := public.guest_personal_contribution(new, v_is_inside);
    if tg_op = 'UPDATE'
       and old.added_by = new.added_by
       and old.event_id = new.event_id then
      v_old_personal := public.guest_personal_contribution(old, v_is_inside);
    end if;

    -- Only a net increase can breach the limit.
    if v_new_personal > v_old_personal then
      -- Serialise concurrent adds by this same (event, adder): block until any
      -- other in-flight add for this pair has committed/rolled back, so the
      -- recompute below always sees the true prior state.
      perform pg_advisory_xact_lock(1, hashtext(new.event_id::text || ':' || new.added_by::text));

      v_quota := public.user_event_quota(new.event_id, new.added_by);
      v_consumed := public.user_event_consumption(new.event_id, new.added_by);
      if v_consumed > v_quota then
        raise exception using
          errcode = '45001',
          message = format(
            'Quotum overschreden: dit zou %s van %s plekken gebruiken voor dit event.',
            v_consumed, v_quota),
          hint = format('quota_exceeded;consumed=%s;quota=%s', v_consumed, v_quota);
      end if;
    end if;
  end if;

  -- ---- tier max (entry count; landing/permanent included, removed/denied excluded) ----
  select gt.max_guests into v_tier_max
  from public.guest_tiers gt where gt.id = new.tier_id;

  if v_tier_max is not null then
    v_new_tier := public.guest_tier_contribution(new);
    if tg_op = 'UPDATE' and old.tier_id = new.tier_id then
      v_old_tier := public.guest_tier_contribution(old);
    end if;

    if v_new_tier > v_old_tier then
      -- Serialise concurrent adds into this same tier.
      perform pg_advisory_xact_lock(2, hashtext(new.tier_id::text));

      v_tier_count := public.tier_consumption(new.tier_id);
      if v_tier_count > v_tier_max then
        raise exception using
          errcode = '45002',
          message = format('Tier zit vol: %s van %s plekken bezet.', v_tier_count, v_tier_max),
          hint = format('tier_full;occupied=%s;max=%s', v_tier_count, v_tier_max);
      end if;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity int;
  v_went_live_at timestamptz;
  v_old int := 0;
  v_new int;
  v_total int;
begin
  select e.capacity, e.went_live_at into v_capacity, v_went_live_at
  from public.events e where e.id = new.event_id;

  if v_capacity is null then
    return null;                          -- no cap on this event → nothing to enforce
  end if;

  v_new := public.guest_capacity_contribution(new, v_went_live_at);
  if tg_op = 'UPDATE' and old.event_id = new.event_id then
    v_old := public.guest_capacity_contribution(old, v_went_live_at);
  end if;

  -- Only a net increase can breach the cap (lowering plus_ones / removing is free).
  if v_new > v_old then
    -- Serialise concurrent adds into this same event's total capacity.
    perform pg_advisory_xact_lock(3, hashtext(new.event_id::text));

    v_total := public.event_capacity_consumption(new.event_id);
    if v_total > v_capacity then
      raise exception using
        errcode = '45005',
        message = format('Capaciteit bereikt: dit zou %s van %s plekken voor dit event gebruiken.',
                         v_total, v_capacity),
        hint = format('capacity_exceeded;consumed=%s;capacity=%s', v_total, v_capacity);
    end if;
  end if;
  return null;
end;
$$;

-- CREATE OR REPLACE preserves existing grants; both functions were already
-- revoked from public/anon/authenticated/service_role (20260624090000 /
-- 20260624200000) and stay that way — internal trigger functions only.
