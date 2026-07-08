-- Review 7/7 P4 — C21: events_set_landing_slug (backstop for a blank
-- landing_slug, 20260706100000_influencers_request_links.sql) sliced the date
-- component off `starts_at at time zone 'UTC'`. An event starting 00:00-02:00
-- Europe/Amsterdam is still the previous UTC day (CEST/CET is ahead of UTC), so
-- the backstop baked the wrong day into the permanent, never-editable slug.
-- Mirrors the app-side fix in src/features/events/slug.ts (buildEventSlug
-- always supplies a slug itself in the normal path — this only fires when it
-- doesn't). Body otherwise identical to 20260706100000; only the timezone
-- passed to to_char changes.
create or replace function public.events_set_landing_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base      text;
  v_date      text;
  v_candidate text;
  v_try       int := 0;
begin
  -- If the app already provided a slug (the normal path), use it as-is.
  if new.landing_slug is not null and btrim(new.landing_slug) <> '' then
    return new;
  end if;

  v_base := public.slugify(new.name);
  if v_base = '' then
    v_base := 'event';
  end if;

  v_date := to_char(new.starts_at at time zone 'Europe/Amsterdam', 'YYYY-MM-DD');

  -- Always include the random suffix — the primary defence against slug
  -- enumeration (20260625110000). Candidates must be free in BOTH namespaces.
  loop
    v_candidate := v_base
      || '-' || v_date
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    exit when not exists (
      select 1 from public.events e where e.landing_slug = v_candidate
    ) and not exists (
      select 1 from public.request_links rl where rl.slug = v_candidate
    );
    v_try := v_try + 1;
    exit when v_try > 25; -- practically unreachable; guarantees termination
  end loop;

  new.landing_slug := v_candidate;
  return new;
end;
$$;
