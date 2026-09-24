-- Fase 17 N2 (86ey6bfbe) 2/3 — dispatch wiring: pg_net kick, the service_role
-- RPCs the push-dispatch Edge Function drains the outbox with, and pg_cron
-- (retry sweep + token TTL).
--
-- CONFIG — nothing is hard-coded here. Two Supabase Vault secrets drive it:
--
--   plusone_push_dispatch_url     https://<project-ref>.supabase.co/functions/v1/push-dispatch
--   plusone_push_dispatch_secret  a long random string (≥ 32 chars)
--
-- Unset (every local stack, CI) ⇒ the pipeline SLEEPS: triggers still fill
-- notification_outbox, kick_push_dispatch() is a no-op, and claim_push_outbox
-- refuses every caller. Runbook: docs/push-dispatch.md.
--
-- Caller authentication for the Edge Function: the function is deployed with
-- verify_jwt = false (supabase/config.toml) and forwards the
-- x-push-dispatch-secret header it received into claim_push_outbox(), which
-- compares it against the Vault secret. The secret therefore lives in exactly
-- one place (Vault), and a caller without it cannot claim a row. The function
-- never takes notification content from the request — it only drains rows
-- the triggers wrote — so even a leaked secret can at worst make queued
-- notifications go out sooner.

-- ── pg_net ───────────────────────────────────────────────────────────────────
-- Guarded like the pg_cron schedules (20260812120000): a stack without the
-- extension still resets; the kick below then degrades to a no-op.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_net with schema extensions;
    exception when others then
      raise notice 'pg_net present but not enabled (%): push dispatch relies on the pg_cron sweep only.', sqlerrm;
    end;
  else
    raise notice 'pg_net unavailable: push dispatch relies on the pg_cron sweep only.';
  end if;
end;
$$;

-- The kick below puts the invocation secret into a pg_net request header, and
-- pg_net persists requests (net.http_request_queue) until its worker sends
-- them. Make sure no app role can read that queue or fire requests itself.
-- Best effort: the objects belong to the extension owner; the pgTAP suite
-- asserts the resulting privilege state either way.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    begin
      -- Schema-wide on purpose (unlike the public grant matrix): this is a
      -- third-party schema no app role has any business in, and USAGE is the
      -- gate that also covers objects a future pg_net version adds.
      revoke usage on schema net from anon, authenticated;
      revoke all on all tables in schema net from anon, authenticated;
      revoke all on all functions in schema net from anon, authenticated;
    exception when others then
      raise notice 'could not tighten net.* privileges (%): see push_dispatch.test.sql', sqlerrm;
    end;
  end if;
end;
$$;

-- ── Vault-backed config ──────────────────────────────────────────────────────
-- Owner-only. Returns null when Vault or the secret is absent.
create or replace function public.push_dispatch_setting(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_name not in ('plusone_push_dispatch_url', 'plusone_push_dispatch_secret') then
    return null;
  end if;
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
      into v using p_name;
  exception when others then
    return null;
  end;
  return nullif(v, '');
end;
$$;

revoke execute on function public.push_dispatch_setting(text) from public, anon, authenticated, service_role;

-- Fire-and-forget wake-up of the Edge Function. pg_net only queues the request
-- inside this transaction; its worker sends it after commit, so the function
-- always sees the committed outbox rows (and a rolled-back request never
-- wakes anything). Never raises.
create or replace function public.kick_push_dispatch()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.push_dispatch_setting('plusone_push_dispatch_url');
  v_secret text := public.push_dispatch_setting('plusone_push_dispatch_secret');
begin
  if v_url is null or v_secret is null then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-push-dispatch-secret', v_secret);
  return true;
exception when others then
  raise warning 'push dispatch kick failed: % (%)', sqlerrm, sqlstate;
  return false;
end;
$$;

revoke execute on function public.kick_push_dispatch() from public, anon, authenticated, service_role;

-- One kick per INSERT statement that actually queued something (a dedupe hit
-- inserts zero rows and wakes nothing).
create or replace function public.notification_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from new_rows where status = 'pending') then
    perform public.kick_push_dispatch();
  end if;
  return null;
exception when others then
  raise warning 'push dispatch kick trigger failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

revoke execute on function public.notification_outbox_kick() from public, anon, authenticated, service_role;

create trigger notification_outbox_kick
  after insert on public.notification_outbox
  referencing new table as new_rows
  for each statement execute function public.notification_outbox_kick();

-- ── Edge Function RPCs (service_role only) ──────────────────────────────────
-- Retry policy: max 5 attempts, exponential backoff 2^attempts minutes
-- (2, 4, 8, 16) between them; a row stuck in 'sending' for 5 minutes (the
-- function died mid-batch) goes back to 'pending' via the sweep.

-- Claim a batch. The secret check is the Edge Function's caller gate (see the
-- header). Digest comparison so the equality check leaks no useful timing.
-- Returns each row with the recipient's FCM tokens bound to a session that
-- STILL EXISTS — a signed-out/expired session's device gets nothing even
-- before the TTL sweep removes its row.
create or replace function public.claim_push_outbox(p_secret text, p_limit integer default 50)
returns table (
  id uuid,
  kind text,
  payload jsonb,
  attempts integer,
  tokens jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_secret text := public.push_dispatch_setting('plusone_push_dispatch_secret');
begin
  if v_secret is null
     or p_secret is null
     or extensions.digest(p_secret, 'sha256') <> extensions.digest(v_secret, 'sha256') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select o.id
    from public.notification_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.next_attempt_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
    for update skip locked
  ),
  claimed as (
    update public.notification_outbox o
    set status = 'sending', attempts = o.attempts + 1, locked_at = now()
    from due
    where o.id = due.id
    returning o.id, o.kind, o.payload, o.attempts, o.recipient_user_id
  )
  select
    c.id, c.kind, c.payload, c.attempts,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token))
      from public.push_tokens t
      where t.user_id = c.recipient_user_id
        and t.transport = 'fcm'
        and exists (select 1 from auth.sessions s where s.id = t.session_id)
    ), '[]'::jsonb)
  from claimed c;
end;
$$;

-- Record the outcome of one claimed row. Only a row currently 'sending' moves.
--   sent    → delivered to at least one device
--   skipped → nothing to deliver to (no live token / every token pruned)
--   retry   → transient failure; back to 'pending' with backoff, or 'failed'
--             once attempts reach 5
--   failed  → permanent failure
create or replace function public.complete_push_outbox(
  p_id uuid,
  p_outcome text,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_outcome not in ('sent', 'skipped', 'retry', 'failed') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;

  update public.notification_outbox o
  set status = case
                 when p_outcome = 'retry' and o.attempts >= 5 then 'failed'
                 when p_outcome = 'retry' then 'pending'
                 else p_outcome
               end,
      next_attempt_at = case
                          when p_outcome = 'retry'
                            then now() + make_interval(mins => power(2, least(o.attempts, 10))::int)
                          else o.next_attempt_at
                        end,
      last_error = left(p_error, 500),
      locked_at = null,
      sent_at = case when p_outcome = 'sent' then now() else o.sent_at end
  where o.id = p_id and o.status = 'sending'
  returning o.status into v_status;

  return v_status;
end;
$$;

-- Remove device rows FCM reported as permanently dead (UNREGISTERED, invalid
-- token, sender mismatch). Bounded input.
create or replace function public.prune_push_tokens(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'too many ids' using errcode = '22023';
  end if;
  delete from public.push_tokens where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.claim_push_outbox(text, integer) from public, anon, authenticated, service_role;
revoke execute on function public.complete_push_outbox(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.prune_push_tokens(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_push_outbox(text, integer) to service_role;
grant execute on function public.complete_push_outbox(uuid, text, text) to service_role;
grant execute on function public.prune_push_tokens(uuid[]) to service_role;

-- ── pg_cron jobs (owner-only functions) ─────────────────────────────────────

-- Every 2 minutes: un-stick rows a crashed invocation left in 'sending', then
-- wake the function if anything is due (covers backoff retries and any kick
-- pg_net dropped).
create or replace function public.push_outbox_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due integer;
begin
  update public.notification_outbox o
  set status = case when o.attempts >= 5 then 'failed' else 'pending' end,
      last_error = coalesce(o.last_error, 'stuck in sending'),
      locked_at = null
  where o.status = 'sending' and o.locked_at < now() - interval '5 minutes';

  select count(*)::integer into v_due
  from public.notification_outbox o
  where o.status = 'pending' and o.next_attempt_at <= now();

  if v_due > 0 then
    perform public.kick_push_dispatch();
  end if;
  return v_due;
end;
$$;

-- Daily hygiene: device rows unseen for 90 days or bound to a session that no
-- longer exists (signed out / expired — the device can never receive for it
-- again), and finished outbox rows older than 30 days.
create or replace function public.prune_stale_push_tokens()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.push_tokens t
  where t.last_seen_at < now() - interval '90 days'
     or not exists (select 1 from auth.sessions s where s.id = t.session_id);
  get diagnostics n = row_count;

  delete from public.notification_outbox o
  where o.status in ('sent', 'skipped', 'failed')
    and o.created_at < now() - interval '30 days';

  return n;
end;
$$;

revoke execute on function public.push_outbox_sweep() from public, anon, authenticated, service_role;
revoke execute on function public.prune_stale_push_tokens() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule(
        'plusone-push-outbox-sweep',
        '*/2 * * * *',
        'select public.push_outbox_sweep();');
      perform cron.schedule(
        'plusone-push-token-prune',
        '17 3 * * *',
        'select public.prune_stale_push_tokens();');
      raise notice 'pg_cron: scheduled plusone-push-outbox-sweep (2 min) + plusone-push-token-prune (daily).';
    exception when others then
      raise notice 'pg_cron present but not enabled (%): schedule public.push_outbox_sweep() and public.prune_stale_push_tokens() by other means.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable: schedule public.push_outbox_sweep() and public.prune_stale_push_tokens() by other means.';
  end if;
end;
$$;
