-- Follow-up to 20260713160000_venue_id_rls_integrity.sql (86ey9e84m): the
-- Supabase security linter (0011_function_search_path_mutable) flagged
-- public.pin_event_venue() for a mutable search_path — every other function
-- in this codebase pins `set search_path = ''`, this one was missed. The
-- function only touches OLD/NEW of the current row (no schema-unqualified
-- references), so this was never actually exploitable, but pin it anyway to
-- match convention and clear the advisory.

create or replace function public.pin_event_venue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.venue_id := old.venue_id;
  return new;
end;
$$;
