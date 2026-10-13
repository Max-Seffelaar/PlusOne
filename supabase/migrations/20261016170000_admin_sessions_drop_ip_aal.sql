-- Contract step for 20261016130000_definer_rpc_profile_scope (spec #64b).
--
-- admin_list_user_sessions returned ip and aal as always-null columns so the
-- app version deployed at the time kept compiling against the old row shape.
-- Since the privacy train (#477) no app code reads either column from this
-- RPC (fetchUserSessions / adminListSessions map them to null themselves), so
-- the columns go: a venue admin's view of a member's sessions has no slot for
-- that member's IP address or MFA level at all.
--
-- A RETURNS TABLE shape cannot change through CREATE OR REPLACE, so the
-- function is dropped and created again. Nothing in the database depends on
-- it. list_own_sessions (the caller's own sessions) keeps ip and aal.

drop function public.admin_list_user_sessions(uuid);

create function public.admin_list_user_sessions(p_target uuid)
returns table (
  session_id uuid, created_at timestamptz, updated_at timestamptz,
  not_after timestamptz, user_agent text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.venue_memberships caller
    join public.venue_memberships target on target.venue_id = caller.venue_id
    where caller.user_id = auth.uid()
      and caller.roles @> '{admin}'::public.venue_role[]
      and target.user_id = p_target
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select s.id, s.created_at, s.updated_at, s.not_after, s.user_agent
    from auth.sessions s
    where s.user_id = p_target
    order by s.updated_at desc;
end;
$$;

-- A new function starts with EXECUTE for PUBLIC: state the matrix.
revoke execute on function public.admin_list_user_sessions(uuid) from public, anon;
grant execute on function public.admin_list_user_sessions(uuid) to authenticated, service_role;
