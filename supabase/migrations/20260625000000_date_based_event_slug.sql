-- ---------------------------------------------------------------------------
-- Date-based landing slugs (replaces random-suffix generation)
-- ---------------------------------------------------------------------------
-- New events get a slug of the form  name-yyyy-mm-dd  (e.g. summer-rave-2026-07-12).
-- On the rare cross-venue collision the trigger appends a counter: -2, -3, …
-- Existing slugs are untouched — shared links never break.
-- ---------------------------------------------------------------------------

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
  -- Respect an explicit slug supplied by the caller (uniqueness enforced by the
  -- unique index → 23505 if it clashes).
  if new.landing_slug is not null and btrim(new.landing_slug) <> '' then
    return new;
  end if;

  v_base := public.slugify(new.name);
  if v_base = '' then
    v_base := 'event';
  end if;

  v_date      := to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD');
  v_candidate := v_base || '-' || v_date;

  loop
    exit when not exists (
      select 1 from public.events e where e.landing_slug = v_candidate
    );
    v_try       := v_try + 1;
    v_candidate := v_base || '-' || v_date || '-' || v_try::text;
    -- Practically unreachable; guarantees termination.
    exit when v_try > 25;
  end loop;

  new.landing_slug := v_candidate;
  return new;
end;
$$;
