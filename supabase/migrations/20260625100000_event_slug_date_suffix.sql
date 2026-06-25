-- Replace random-suffix slug generation with name-yyyy-mm-dd.
-- First occurrence: "summer-rave-2026-07-12".
-- Collision (same slugified name + same date): append -2, -3, …
-- Existing landing_slug values are untouched (the trigger still short-circuits
-- when landing_slug is already set, so no shared link breaks).

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
  if new.landing_slug is not null and btrim(new.landing_slug) <> '' then
    return new;
  end if;

  v_base := public.slugify(new.name);
  if v_base = '' then
    v_base := 'event';
  end if;

  v_date      := to_char(new.starts_at at time zone 'utc', 'YYYY-MM-DD');
  v_candidate := v_base || '-' || v_date;

  loop
    exit when not exists (
      select 1 from public.events e where e.landing_slug = v_candidate
    );
    v_try      := v_try + 1;
    v_candidate := v_base || '-' || v_date || '-' || (v_try + 1)::text;
    exit when v_try > 25;
  end loop;

  new.landing_slug := v_candidate;
  return new;
end;
$$;
