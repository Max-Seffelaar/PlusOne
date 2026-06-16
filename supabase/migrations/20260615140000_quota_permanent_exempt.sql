-- Sessie C — Permanente gasten zijn quota-vrijgesteld (#11, quota decision).
--
-- A 'permanent' guest is the venue's own house guest, auto-synced onto the
-- event; it must never charge anyone's personal quota — exactly like 'landing'
-- (#31). It DOES still count toward tier-max (that path is source-agnostic and
-- is left unchanged).
--
-- Two CREATE OR REPLACE's, identical to 20260613180000 except the source guard
-- widens from 'landing' to ('landing','permanent'). Same signatures, so the
-- existing enforce_guest_quota trigger binding and the EXECUTE revokes are
-- preserved; re-asserted at the end for explicitness.

-- Per-row contribution to PERSONAL quota consumption (single source of truth).
create or replace function public.guest_personal_contribution(g public.guests, p_went_live_at timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when g.source in ('landing', 'permanent') then 0  -- #31 + #11: outside personal quota
    when g.status = 'denied' then 0                    -- never consumed
    when g.status <> 'removed' then 1 + g.plus_ones
    -- removed: only counts if removed at/after go-live (#22)
    when p_went_live_at is not null and g.removed_at >= p_went_live_at then 1 + g.plus_ones
    else 0
  end;
$$;

-- Enforcement trigger (AFTER ROW): block changes that push a non-exempt user
-- over quota, or a guest into a full tier. Unchanged from 20260613180000 except
-- the personal-quota guard now also skips 'permanent'.
create or replace function public.enforce_guest_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_went_live_at timestamptz;
  v_old_personal int := 0;
  v_new_personal int := 0;
  v_quota int;
  v_consumed int;
  v_tier_max int;
  v_old_tier int := 0;
  v_new_tier int := 0;
  v_tier_count int;
begin
  select e.went_live_at into v_went_live_at
  from public.events e where e.id = new.event_id;

  -- ---- personal quota (non-exempt adders only; landing/permanent never count) ----
  if new.source not in ('landing', 'permanent')
     and not public.user_is_quota_exempt(new.event_id, new.added_by) then

    v_new_personal := public.guest_personal_contribution(new, v_went_live_at);
    if tg_op = 'UPDATE'
       and old.added_by = new.added_by
       and old.event_id = new.event_id then
      v_old_personal := public.guest_personal_contribution(old, v_went_live_at);
    end if;

    -- Only a net increase can breach the limit.
    if v_new_personal > v_old_personal then
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
    -- old only contributed to THIS tier if the tier was unchanged.
    if tg_op = 'UPDATE' and old.tier_id = new.tier_id then
      v_old_tier := public.guest_tier_contribution(old);
    end if;

    if v_new_tier > v_old_tier then
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

-- Re-assert the internal-only posture (CREATE OR REPLACE preserves ACLs, but be
-- explicit): neither function is callable by app roles; they run in trigger /
-- SECURITY DEFINER context.
revoke execute on function
  public.guest_personal_contribution(public.guests, timestamptz),
  public.enforce_guest_quota()
from public, anon, authenticated, service_role;
