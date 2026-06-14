-- Fase 9 — Door app realtime: stream check-ins (and guest changes) to the door.
--
-- The door PWA (spec §4 point 3, decision #11) shows colleagues' check-ins within
-- ~1s via Supabase Realtime. postgres_changes only delivers rows from tables that
-- are members of the `supabase_realtime` publication — these two are NOT yet in it
-- (this migration is the only place the publication is touched).
--
-- RLS still applies to realtime: a subscriber receives a change only if their
-- session may SELECT that row (check_ins_select / guests_select, fase 2). So a
-- doorhost gets check-ins for guests at their own venue and nothing else.
--
-- check_ins has no event_id column, so the client filters received check-ins by
-- guest_id against its local snapshot; guests carry event_id for a server-side
-- filter. No replica-identity change is needed — we only consume the NEW row on
-- INSERT/UPDATE, which the default (primary-key) identity already provides.
--
-- Idempotent: guarded so `supabase db reset` re-applies cleanly.

do $$
begin
  -- The publication is created by Supabase's own bootstrap migrations; create it
  -- defensively so a bare Postgres (or a reordered reset) still applies.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'check_ins'
  ) then
    alter publication supabase_realtime add table public.check_ins;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guests'
  ) then
    alter publication supabase_realtime add table public.guests;
  end if;
end $$;
