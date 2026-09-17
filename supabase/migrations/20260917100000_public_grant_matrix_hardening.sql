-- Grant-matrix hardening for schema public — close the anon/authenticated
-- privileges that Supabase's stock default ACLs handed out silently.
--
-- WHAT WENT WRONG
-- 20260613000000_full_schema.sql got this right, and said so:
--
--   -- Default ACLs differ between local and hosted Supabase, so we reset to
--   -- zero and grant exactly the intended surface.
--   revoke all on all tables in schema public from anon, authenticated, service_role;
--
-- The design was correct. The mechanism was not: `all tables in schema` is a
-- SNAPSHOT, not a rule. It zeroed the fifteen tables that existed on
-- 2026-06-13 and has protected nothing created since. Supabase's stock
--
--   alter default privileges for role postgres in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
--
-- then handed the full privilege set to anon and authenticated on every table
-- and view a later migration created. Most later migrations repeated the
-- revoke by hand and stayed clean. Three did not, leaving six objects open:
--
--   event_templates, event_template_tiers   (20260624091000)
--   influencers, request_links,
--   request_link_pageviews_daily            (20260706100000)
--   audit_feed (view)                       (20260614120000, recreated 20260706104000)
--
-- 20260706100000 even carries the comment "explicit grant matrix" and "No
-- DELETE for app roles anywhere (soft delete only, #21)" above a block that
-- only ever GRANTS. Every grant it wrote was a subset of what the table
-- already had, so the block changed nothing and the comment described a state
-- the database never reached.
--
-- REACHABILITY (measured on prod before writing this, not assumed)
-- Nothing was exploitable. RLS is on for all five tables and every policy on
-- them is scoped `to authenticated`, so an anon PostgREST request matches no
-- policy and default-denies; TRUNCATE ignores RLS but PostgREST never issues
-- it. audit_feed is `security_invoker=on` over a CTE + six LEFT JOINs, so it is
-- not auto-updatable and its INSERT/UPDATE/DELETE grants cannot execute.
-- This migration restores the second line of defence, which is what the grant
-- matrix is for: one policy ever written without `to authenticated` on those
-- five tables would otherwise have been live for the public anon key.
--
-- Decisions: #1 (RLS is the security boundary, grants are the layer under it),
-- #21/#4 (soft delete only; audit history immutable).

-- ---------------------------------------------------------------------------
-- 1. anon owns nothing in public
-- ---------------------------------------------------------------------------
-- Almost nothing in this schema is meant to be reachable by the anon key:
-- landing requests, /i/<token> pageviews and status tokens all go through a
-- SECURITY DEFINER RPC with its own execute grant, never a table privilege.
revoke all on table public.event_templates              from anon;
revoke all on table public.event_template_tiers         from anon;
revoke all on table public.influencers                  from anon;
revoke all on table public.request_link_pageviews_daily from anon;
revoke all on table public.audit_feed                   from anon;

-- request_links is the ONE deliberate exception, and SELECT is the only part
-- of it that is deliberate: `20260706103000_submit_via_request_link.sql:426`
-- grants it on purpose. Exactly one live thing depends on it — `/api/health`,
-- which probes this table precisely because the grant means the query never
-- 42501s while the absent anon SELECT policy means it always returns zero rows
-- (src/app/api/health/route.ts spells the reasoning out, including a warning to
-- grep every migration before repointing the probe).
--
-- The grant's ORIGINAL second reason no longer applies: `guest_requests_insert_public`
-- is scoped {anon, authenticated} and its WITH CHECK subquery reads request_links
-- as the caller, but `20260707170000_p0_security_hotfixes.sql` (C2) revoked INSERT
-- on guest_requests from anon, so that half of the policy is dead for anon and the
-- live half runs as authenticated, which has its own SELECT. Follow-up worth doing
-- separately: point the health probe at a trivial anon-executable RPC instead, and
-- this last anon table grant in the whole schema can go too.
--
-- So: keep SELECT, drop everything the default ACL added on top of it.
revoke insert, update, delete, truncate, references, trigger
  on table public.request_links from anon;

-- ---------------------------------------------------------------------------
-- 2. authenticated gets exactly what each migration declared it should
-- ---------------------------------------------------------------------------
-- event_templates / event_template_tiers: 20260624091000 grants select, insert,
-- update, delete (real delete policies exist — a template is config, not guest
-- data). Only TRUNCATE is unintended.
revoke truncate on table public.event_templates      from authenticated;
revoke truncate on table public.event_template_tiers from authenticated;

-- influencers / request_links: declared select, insert, update. No delete
-- policy exists for either, so the DELETE privilege was dead weight on top of
-- an RLS default-deny — and exactly the kind of dead weight that becomes live
-- the day someone adds a delete policy without re-reading the grant matrix.
revoke delete, truncate on table public.influencers   from authenticated;
revoke delete, truncate on table public.request_links from authenticated;

-- request_link_pageviews_daily: declared select for authenticated (the funnel
-- RPCs read it as SECURITY INVOKER); writes belong to record_link_pageview,
-- which is SECURITY DEFINER and owned by postgres, so stripping the write
-- privileges here does not touch the counter path.
revoke insert, update, delete, truncate
  on table public.request_link_pageviews_daily from authenticated;

-- audit_feed: a read-only projection over audit_log (#4 — audit history is
-- append-only and never mutated from the app layer).
revoke insert, update, delete, truncate on table public.audit_feed from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stop the recurrence at the source
-- ---------------------------------------------------------------------------
-- Without this, the next `create table` in public re-acquires the full anon and
-- authenticated privilege set, and the only thing standing between us and a
-- repeat is that whoever writes it remembers the revoke. Six objects over three
-- months say that is not a reliable control.
--
-- After this, a new table or view in public starts CLOSED for both app roles.
-- The `grant select, insert, update on table X to authenticated` lines our
-- migrations already write stop being decorative and start being the thing that
-- actually opens the table — which is what "explicit grant matrix" was supposed
-- to mean all along. A migration that forgets them now fails loudly (403 in dev,
-- e2e smoke red) instead of silently shipping an open table.
--
-- This only covers objects created BY ROLE postgres, which is every object in
-- public today (`pg_class.relowner`). The `supabase_admin` default ACL in this
-- schema still grants anon everything, and we cannot change it: postgres is not
-- a member of supabase_admin on hosted Supabase, so the statement would fail
-- there while succeeding locally — a divergence worse than the gap. The guard
-- test closes it from the other side instead: it checks the default ACL of
-- every role that actually owns a relation in public, so an object arriving
-- under a different owner fails the build rather than inheriting open defaults.
--
-- service_role is deliberately left alone: it is the trusted server role, it
-- bypasses RLS by design, and its key never reaches client code (CLAUDE.md).
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;
