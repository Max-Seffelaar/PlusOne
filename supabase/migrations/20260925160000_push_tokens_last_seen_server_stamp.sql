-- Fase 17 N5 review (86ey6bfkb) — push_tokens.last_seen_at is server-owned.
--
-- Until now push_tokens_stamp() (20260925120000) set last_seen_at only on
-- INSERT, so the client had to send last_seen_at on every re-registration
-- (the upsert's ON CONFLICT → UPDATE path) to keep an active device out of
-- the 90-day TTL sweep (prune_stale_push_tokens, 20260925120100). That made
-- the TTL input client-controlled. From here on the trigger stamps
-- last_seen_at := now() on INSERT AND on UPDATE for every end-user write,
-- whatever the client sends; the N5 client no longer sends it at all. Any
-- UPDATE of the owner's row — which is exactly what the upsert's conflict path
-- is — counts as "seen".
--
-- Everything else is unchanged, verbatim: SECURITY DEFINER, search_path '',
-- the session stamp, the INSERT owner check + device handover, the pinned
-- id/created_at on UPDATE, and the service_role/owner pass-through (migrations,
-- seed and pgTAP fixtures still write last_seen_at as given — the TTL tests
-- depend on that). CREATE OR REPLACE keeps the function's ACL and the
-- trigger binding; the revoke below restates the ACL so this file alone shows it.
--
-- Grants: unchanged. No column-level grant narrowing — the trigger overwrites
-- the column on every end-user write, so a client value is inert either way.
--
-- Deploy: prod-push flow (CLAUDE.md "Env & prod-push"). The currently deployed
-- client still sends last_seen_at; it is simply overwritten (expand-contract
-- safe in both directions).

create or replace function public.push_tokens_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_sid is null then
    raise exception 'push token requires a session' using errcode = '42501';
  end if;
  new.session_id := v_sid;
  -- Server clock only: the TTL sweep's input is never the client's to set.
  new.last_seen_at := now();

  if tg_op = 'INSERT' then
    -- Checked here, not only by the INSERT policy (which runs after this
    -- trigger): the handover delete below must never run for a forged owner.
    if new.user_id is distinct from (select auth.uid()) then
      raise exception 'push token owner must be the caller' using errcode = '42501';
    end if;
    new.created_at := now();
    delete from public.push_tokens p
    where p.transport = new.transport
      and p.token = new.token
      and p.user_id <> new.user_id;
  else
    -- Identity of the row is not the client's to rewrite.
    new.id := old.id;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

revoke execute on function public.push_tokens_stamp() from public, anon, authenticated, service_role;
