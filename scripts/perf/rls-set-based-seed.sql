-- Perf fixture for z8uq9m2xz2 9-DB (set-based RLS, audit finding 13).
-- LOCAL STACK ONLY — never run against prod.
--
-- Two events at Club Vesper (aa..01, the seed company): one with 150 guests,
-- one with 25 000. 10% of each list is added by staff Tom (55..5), the rest by
-- admin Max (11..1, quota-exempt). Tom gets an event_quotas override big
-- enough for his share, so the quota trigger stays on (CLAUDE.md: never
-- disable triggers, not even in seed helpers).
--
--   docker exec -i supabase_db_PlusOne_Guestlist psql -U postgres -v ON_ERROR_STOP=1 \
--     < scripts/perf/rls-set-based-seed.sql
--
-- Idempotent: re-running is a no-op once the events exist.

\set ON_ERROR_STOP 1

do $$
declare
  v_venue constant uuid := 'aa000000-0000-7000-8000-000000000001';
  v_admin constant uuid := '11111111-1111-4111-8111-111111111111';
  v_staff constant uuid := '55555555-5555-4555-8555-555555555555';
  r record;
begin
  if exists (select 1 from public.events where id = 'ef000000-0000-7000-8000-000000000150') then
    raise notice 'perf fixture already present';
    return;
  end if;

  -- Audit triggers record auth.uid(); run the inserts as the admin.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  for r in
    select * from (values
      ('ef000000-0000-7000-8000-000000000150'::uuid, 'ed000000-0000-7000-8000-000000000150'::uuid, 150,   'Perf 150'),
      ('ef000000-0000-7000-8000-000000025000'::uuid, 'ed000000-0000-7000-8000-000000025000'::uuid, 25000, 'Perf 25k')
    ) as t(event_id, tier_id, n, name)
  loop
    insert into public.events (id, venue_id, name, starts_at, ends_at, status)
    values (r.event_id, v_venue, r.name, now() + interval '7 days',
            now() + interval '7 days 6 hours', 'open');
    insert into public.guest_tiers (id, event_id, name, color, aliases)
    values (r.tier_id, r.event_id, 'Regular', '#8A8A93', '{}');
    insert into public.event_quotas (event_id, user_id, quota_override)
    values (r.event_id, v_staff, r.n);

    insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by)
    select r.event_id, r.tier_id, 'Perf guest ' || g, 0,
           case when g % 10 = 0 then v_staff else v_admin end
      from generate_series(1, r.n) g;
  end loop;
end
$$;

analyze public.guests;
analyze public.events;
analyze public.venue_memberships;
analyze public.event_organizers;
