-- Bind raw-PostgREST callers to the public throttle (independent review of
-- PR #379, 2026-10-05; pre-existing since 20260706102000 / 20260707170000).
--
-- THE HOLE. Every anon RPC throttles on a key it builds from its own argument:
-- consume_public_throttle('<prefix>:' || p_ip_hash, ...). p_ip_hash is
-- CALLER-SUPPLIED. The app always passes a salted hash of the client IP (the
-- 'no-ip' fallback included), but anyone holding the public anon key can POST
-- to /rest/v1/rpc/<fn> directly and either
--   * pass p_ip_hash => null: the key concatenates to NULL and the helper
--     skipped throttling for a NULL key by design, or
--   * pass a fresh random string per call: a fresh bucket every time.
-- Surfaces: submit_guest_request ('req:', 5/15 min), record_link_pageview
-- ('pv:', 60), get_landing_event ('slug:', 60), get_request_status ('st:', 30),
-- get_influencer_stats ('if:', 30). This is more than a slug oracle: Turnstile
-- runs in the Next server action, so a raw caller skips it too, and the throttle
-- was the only remaining volume cap on submit_guest_request — an unbounded
-- pending-queue flood, fake contacts in a venue's CRM, and on an auto-approve
-- link the link's cap filled with junk guests. record_link_pageview inflates a
-- promoter's funnel numbers.
--
-- THE CHOICE (options from the task; reasoning in the PR):
--   1. Coalesce a NULL key: necessary but not sufficient — a rotating random
--      key still gets a fresh bucket per call. Done here, below.
--   2. A per-slug/global secondary bucket regardless of caller key: a per-slug
--      bucket does nothing against probing (the prober rotates slugs too), and
--      a global one sized for real traffic across all venues is no cap at all,
--      while one sized as a cap hands any anonymous caller a zero-cost DoS of
--      every venue's public funnel. Rejected.
--   3. Derive the key server-side from request.headers: as stated it breaks the
--      app. The app calls these RPCs from the Vercel server, so the IP that
--      PostgREST sees is a Vercel egress address shared by every guest of every
--      venue — one bucket for the whole product. The useful part of option 3 is
--      the header channel itself: the DB CAN tell the app server apart from
--      everyone else if the app server proves it.
-- Picked: option 1 + option 3 as trust, not as identity. The app server sends a
-- server-only secret in the `x-plusone-throttle-trust` header; the DB stores only
-- its sha256. A call that presents a matching secret keeps today's per-hash
-- budget (door WiFi: many phones behind one NAT IP = one hash = 15/60, exactly as
-- before). A call that does not is thrown into ONE shared bucket per surface
-- ('<prefix>:~untrusted') with that surface's own budget — rotating p_ip_hash
-- buys nothing, and exhausting that bucket hurts only other untrusted callers,
-- of which the product has none (every legitimate call goes through the Next
-- server; the native shell is the remote-URL model, same server).
--
-- ROLLOUT — enforcement is OFF until a secret row exists, so this migration
-- changes nothing for the deployed app on its own. Order matters (runbook:
-- docs/landing-rate-limit-hardening.md, Punt 5):
--   1. PUBLIC_RPC_TRUST_SECRET in Vercel (Production) — the build guard
--      requires it — and deploy: the app starts sending the header, which the
--      DB ignores while no row exists.
--   2. Insert the secret's sha256 into public_throttle_trusted_callers.
--      From that moment untrusted callers share the per-surface buckets.
-- Reversing step 2 (delete the rows) is the kill switch. Rotation: add the new
-- row, deploy the new env value, delete the old row — several rows may be live.
--
-- Until step 2 runs, only the NULL-key half of the fix is live (a NULL key now
-- lands in 'anon:~untrusted' instead of skipping the throttle).

-- ---------------------------------------------------------------------------
-- 1. Trusted-caller secrets (sha256 only)
-- ---------------------------------------------------------------------------
-- Owner-only, like push_dispatch_tokens (20260925120100): RLS on, no policies,
-- no app-role grant. Read solely inside consume_public_throttle (SECURITY
-- DEFINER). Holds a digest of a 256-bit random secret, not the secret.

create table public.public_throttle_trusted_callers (
  secret_sha256 bytea primary key check (octet_length(secret_sha256) = 32),
  label         text not null check (length(btrim(label)) > 0),
  created_at    timestamptz not null default now()
);

comment on table public.public_throttle_trusted_callers is
  'sha256 of the server-only secret the app sends as x-plusone-throttle-trust '
  '(20261006170000). Any row present = enforcement on: anon-RPC throttle keys '
  'built from a caller-supplied p_ip_hash are honoured only for a caller that '
  'presents a matching secret. No app-role grants.';

alter table public.public_throttle_trusted_callers enable row level security;

revoke all on table public.public_throttle_trusted_callers from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. consume_public_throttle: NULL key + untrusted callers bucketed
-- ---------------------------------------------------------------------------
-- Same signature, same fixed-window upsert as 20260706102000; only the key the
-- counter lands on changes. Centralised here rather than in each anon RPC so
-- the five SECURITY DEFINER bodies are not redefined (PR #379 is redefining
-- get_landing_event in parallel) and the trust decision lives in one place.
-- The prefix list below is guarded by tests/unit/public-throttle-prefixes.test.ts:
-- a new anon surface that builds its key from p_ip_hash under a prefix missing
-- here fails CI instead of failing open.

create or replace function public.consume_public_throttle(
  p_key        text,
  p_window_min integer,
  p_max        integer
)
returns boolean -- true = within budget, false = rate-limited
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key    text := p_key;
  v_prefix text;
  v_secret text;
  v_count  integer;
begin
  if v_key is null then
    -- Only a raw caller passing p_ip_hash => null gets here (the app always
    -- sends a hash). One shared bucket instead of no throttle at all.
    v_key := 'anon:~untrusted';
  else
    v_prefix := split_part(v_key, ':', 1);
    -- Prefixes whose key embeds a CALLER-SUPPLIED p_ip_hash. Server-derived
    -- keys (e.g. 'pinv:' || auth.uid()) are not in the list and are untouched.
    if v_prefix in ('req', 'pv', 'st', 'if', 'slug')
       and exists (select 1 from public.public_throttle_trusted_callers) then
      v_secret := nullif(current_setting('request.headers', true), '')::json
                  ->> 'x-plusone-throttle-trust';
      if v_secret is null or not exists (
        select 1
        from public.public_throttle_trusted_callers c
        where c.secret_sha256 = extensions.digest(v_secret, 'sha256')
      ) then
        v_key := v_prefix || ':~untrusted';
      end if;
    end if;
  end if;

  insert into public.landing_request_throttle as t
    (ip_hash, window_started_at, request_count)
  values (v_key, now(), 1)
  on conflict (ip_hash) do update
    set request_count = case
          when t.window_started_at < now() - make_interval(mins => p_window_min)
            then 1
          else t.request_count + 1
        end,
        window_started_at = case
          when t.window_started_at < now() - make_interval(mins => p_window_min)
            then now()
          else t.window_started_at
        end,
        updated_at = now()
  returning t.request_count into v_count;

  return v_count <= p_max;
end;
$$;

comment on function public.consume_public_throttle(text, integer, integer) is
  'Fixed-window throttle (20260706102000; caller binding 20261006170000). A NULL '
  'key lands in the shared anon:~untrusted bucket. With a row in '
  'public_throttle_trusted_callers, a req/pv/st/if/slug key is honoured only when '
  'the request carries a matching x-plusone-throttle-trust header, else it lands '
  'in <prefix>:~untrusted. p_window_min must stay well under 2h: '
  'cleanup_landing_request_throttle (20260812120000) deletes any row idle >2h, so '
  'a window close to or past that ceiling would let its own counter get swept '
  'mid-window.';

-- Internal only: called from the SECURITY DEFINER public RPCs, never directly.
revoke execute on function public.consume_public_throttle(text, integer, integer)
from public, anon, authenticated, service_role;
