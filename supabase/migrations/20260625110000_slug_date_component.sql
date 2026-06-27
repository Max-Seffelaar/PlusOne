-- Add the event date to the auto-generated landing slug.
--
-- New format: {name}-{YYYY-MM-DD}-{4-char-random}
-- Example:    launch-night-2026-07-15-x4k9
--
-- Previously: {name}-{4-char-random}  (first event got just {name}, no suffix)
--
-- Why: a slug that is purely name-based is predictable. A bot can guess
-- "launch-night-x4k9" is plausible and enumerate a small keyspace. Adding the
-- date means the bot must also know the date, and the random suffix makes even
-- that insufficient.
--
-- The trigger only fires when landing_slug is NULL/empty on INSERT (i.e. the
-- app did not supply one). Existing slugs are never touched.
-- Mirrors the updated buildEventSlug() in src/features/events/slug.ts.

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

  -- Date component from the event start time (UTC). Keeps slug human-readable
  -- and avoids collisions between same-named events on different dates.
  v_date := to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD');

  -- Always include the random suffix — it is not just for collision avoidance,
  -- it is the primary defence against slug enumeration.
  loop
    v_candidate := v_base
      || '-' || v_date
      || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    exit when not exists (
      select 1 from public.events e where e.landing_slug = v_candidate
    );
    v_try := v_try + 1;
    exit when v_try > 25; -- practically unreachable; guarantees termination
  end loop;

  new.landing_slug := v_candidate;
  return new;
end;
$$;
