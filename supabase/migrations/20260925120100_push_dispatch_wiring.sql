-- Fase 17 N2 (86ey6bfbe) 2/3 — dispatch wiring: pg_net kick, the service_role
-- RPCs the push-dispatch Edge Function drains the outbox with, and pg_cron
-- (retry sweep + token TTL).
--
-- CONFIG — nothing is hard-coded here. One Supabase Vault secret drives it:
--
--   plusone_push_dispatch_url   https://<project-ref>.supabase.co/functions/v1/push-dispatch
--
-- Unset (every local stack, CI) ⇒ the pipeline SLEEPS: triggers still fill
-- notification_outbox, kick_push_dispatch() is a no-op, and claim_push_outbox
-- refuses every caller (no token was ever issued). Runbook: docs/push-dispatch.md.
--
-- Caller authentication for the Edge Function (deployed with verify_jwt =
-- false, supabase/config.toml): every kick mints a fresh random 256-bit token,
-- stores only its sha256 in push_dispatch_tokens, and sends the token as the
-- x-push-dispatch-token header. The function forwards it to
-- claim_push_outbox(), which CONSUMES it (single use, 10-minute lifetime).
--
-- Why not a static shared secret: pg_net persists each request, headers
-- included, in net.http_request_queue until its worker sends it, and on
-- Supabase the platform grants anon/authenticated USAGE on schema net (plus
-- EXECUTE on net.http_*) — objects owned by supabase_admin, which postgres
-- cannot revoke (verified in CI). A static secret would be readable there by
-- any logged-in user. A single-use token read from the queue is worth at most
-- one early drain of rows the triggers already wrote: the function never takes
-- notification content from the request.

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

-- ── Single-use invocation tokens ─────────────────────────────────────────────
-- Only the sha256 is stored. RLS on, no policies, no grants: written by
-- kick_push_dispatch(), consumed by claim_push_outbox(), swept by
-- push_outbox_sweep() — all SECURITY DEFINER.
create table public.push_dispatch_tokens (
  token_hash bytea primary key,
  created_at timestamptz not null default now()
);

comment on table public.push_dispatch_tokens is
  'Single-use invocation tokens for the push-dispatch Edge Function (Fase 17 N2): sha256 only, 10-minute lifetime, consumed by claim_push_outbox. No app-role grants.';

alter table public.push_dispatch_tokens enable row level security;
revoke all on table public.push_dispatch_tokens from anon, authenticated;

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
  if p_name is distinct from 'plusone_push_dispatch_url' then
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
-- always sees the committed outbox rows (and a rolled-back kick leaves neither
-- a request nor a token). Never raises.
create or replace function public.kick_push_dispatch()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := public.push_dispatch_setting('plusone_push_dispatch_url');
  v_token text;
begin
  if v_url is null then
    return false;
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.push_dispatch_tokens (token_hash)
  values (extensions.digest(v_token, 'sha256'));
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using v_url, '{}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-push-dispatch-token', v_token);
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

-- Claim a batch (one per invocation: the token is single use; anything left
-- over is picked up by the next kick or the 2-minute sweep). The token check
-- is the Edge Function's caller gate (see the header). Returns each row with
-- the recipient's FCM tokens bound to a session that STILL EXISTS — a
-- signed-out/expired session's device gets nothing even before the TTL sweep
-- removes its row.
create or replace function public.claim_push_outbox(p_token text, p_limit integer default 200)
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
begin
  -- Consume: a null token matches nothing, an expired one is left for the sweep.
  delete from public.push_dispatch_tokens t
  where t.token_hash = extensions.digest(p_token, 'sha256')
    and t.created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select o.id
    from public.notification_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.next_attempt_at
    limit least(greatest(coalesce(p_limit, 200), 1), 200)
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

-- Every 2 minutes: un-stick rows a crashed invocation left in 'sending', drop
-- expired invocation tokens, then wake the function if anything is due (covers
-- backoff retries, batches left over by a full claim, and any kick pg_net
-- dropped).
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

  -- Tokens of kicks that never reached the function (or were never used).
  delete from public.push_dispatch_tokens t
  where t.created_at < now() - interval '10 minutes';

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
