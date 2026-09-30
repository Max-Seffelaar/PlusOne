-- Fase 17 N2 (86ey6bfbe) 3/3 — remote logout invalidates push.
--
-- Ending a session must also stop that session's device from receiving push
-- (capacitor-plan §3: no FK into auth.sessions; the revocation RPCs delete by
-- value). Both functions are recreated from their latest definitions with the
-- authorization logic byte-for-byte unchanged:
--   revoke_own_session   — 20260613190000_auth_invites_sessions.sql
--   admin_revoke_session — 20260702120000_mfa_fully_optional.sql (role-only)
-- Same signatures, same return semantics (true iff the auth session row was
-- deleted), so src/features/auth/session-actions.ts needs no change. EXECUTE
-- grants survive CREATE OR REPLACE.
--
-- The push_tokens delete runs only once the caller is authorized for that
-- session, and only for the session actually being revoked. It also runs when
-- the auth row is already gone (a token bound to a dead session is garbage
-- either way — dispatch ignores it and the daily TTL sweep would remove it).

create or replace function public.revoke_own_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  delete from auth.sessions
  where id = p_session_id and user_id = auth.uid();
  v_found := found;

  delete from public.push_tokens
  where session_id = p_session_id and user_id = auth.uid();

  return v_found;
end;
$$;

create or replace function public.admin_revoke_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_found boolean;
begin
  select user_id into v_target from auth.sessions where id = p_session_id;
  if v_target is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.venue_memberships caller
    join public.venue_memberships target on target.venue_id = caller.venue_id
    where caller.user_id = auth.uid()
      and caller.roles @> '{admin}'::public.venue_role[]
      and target.user_id = v_target
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from auth.sessions where id = p_session_id;
  v_found := found;

  delete from public.push_tokens
  where session_id = p_session_id and user_id = v_target;

  return v_found;
end;
$$;
