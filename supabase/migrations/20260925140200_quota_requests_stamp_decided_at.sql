-- quota_requests.decided_at is stamped by the server, not the client
-- (PR #341 review, z8uq9m0y1y).
--
-- After 20260925140000 a client deny may write status/decided_by/decided_at/
-- decision_reason. The decide policy pins status and decided_by, but nothing
-- pinned decided_at: an admin with raw PostgREST access could record a denial
-- with any timestamp (e.g. '2020-01-01'). audit_log.created_at still carried the
-- true time, so the impact was cosmetic, but the column itself lied.
--
-- This BEFORE UPDATE trigger sets decided_at = now() whenever status leaves
-- 'pending' (i.e. on every decision, client deny or approve_quota_request),
-- whatever the statement supplied. now() is the transaction timestamp — the
-- value every server-side decision path already writes — so the RPC path is
-- unchanged. A row going back to pending (only owner-run fixtures do that) is
-- left alone so the table CHECK (pending => decided_at is null) keeps holding.
--
-- EXPAND–CONTRACT: the column grant on decided_at stays. The deployed app still
-- sends decided_at in its deny body; revoking the grant would turn every deny
-- into a 42501. With the trigger the client value is simply ignored, so the
-- grant is harmless and there is nothing left to contract.
--
-- Scope: quota_requests only. guest_requests (20260919150000) has the same
-- column shape but its own BEFORE UPDATE guard and re-approve flow; it is not
-- touched here.
--
-- Trigger function: SECURITY INVOKER (it only assigns NEW), pinned
-- search_path, EXECUTE revoked from every app role (a trigger function is never
-- called directly).

create or replace function public.quota_requests_stamp_decided_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.quota_requests_stamp_decided_at()
  from public, anon, authenticated, service_role;

drop trigger if exists quota_requests_stamp_decided_at on public.quota_requests;
create trigger quota_requests_stamp_decided_at
  before update of status on public.quota_requests
  for each row execute function public.quota_requests_stamp_decided_at();
