# Ticketing-provider integration — technical plan (decision #54)

Status: approved 2026-10-07 (plan mode, Max). Plain-language version: `plan.md`. Provider outreach: `partner-brief.md`. Weeztix specifics: `weeztix.md`. This file is the build reference for ClickUp tasks Ticketing 1–7; it is updated when a PR lands and something turns out different.

## 1. Decisions (not to be reopened)

| Topic | Decision |
|---|---|
| Ticket issuer | The provider issues and mails the ticket. PlusOne creates a free order for a guest already on the list. Closed loop (issue → provider scan → check-in in PlusOne) is mandatory; a provider that cannot close it is not integrated. |
| First adapter | Weeztix. Others behind the same interface, parked at ≥5 venues. |
| Trigger | `guest_tiers.ticket_mode`: `none` / `optional` (ask per guest, toggle on when an e-mail is known) / `required` (e-mail mandatory; app/bulk add without e-mail refused). |
| Door carve-out | Door walk-in into a `required` tier without e-mail is accepted with line status `needs_email`. |
| +N | One order with `1 + plus_ones` tickets to the main guest's e-mail. First scan = check-in, later scans = `plus_ones_arrived` top-up. |
| Extras | Ticket lines per guest (`tier` line + `extra` lines such as parking ×1). One `guests` row per person. Bulk paste groups `name, e-mail, ticket type, qty` lines by e-mail. |
| +N after issue | Delta order, never cancel + reissue. Decrease cancels surplus only when `capabilities.cancelTickets`, else `over_issued`. |
| Names | `first_name` / `last_name` on `guests` and `contacts`; `full_name` stays; no mass backfill UPDATE. |
| Retroactive link | Preview "N have an e-mail, M don't. Issue N now?" → confirm → bulk. |
| Refused + scanned | Check-in row recorded with `source = provider_scan`, `guests.status` stays `refused`, visible in audit + guest row. |
| Event import | Provider events listed; admin picks → create + link, or link an existing event. Never automatic. |
| Secrets | Supabase Vault behind service_role-only RPCs. |
| Worker | Next.js route kicked by pg_net with a single-use token (push pattern). |
| Beta gate | `venues.ticketing_enabled_at`, platform admin only. |

## 2. Ground truth the design leans on

- `check_ins` is not `FORCE ROW LEVEL SECURITY`: a `postgres`-owned SECURITY DEFINER function bypasses `check_ins_insert` / `check_ins_update_door`; `guard_check_in_actor_change()` exempts every role except `authenticated`/`anon` (`supabase/migrations/20260812140000_outbox_owner_stamp_sync.sql`). `cap_check_in_arrivals` (BEFORE, clamps to `guests.plus_ones`, monotonic), `sync_guest_status_from_checkin` (AFTER, `approved → checked_in`) and `set_checkin_scope` fire for everyone, as does the audit trigger. So a definer RPC inserting a check-in gets status sync, clamping, realtime and audit for free.
- `audit_log.actor_id` is nullable; the trigger stamps `auth.uid()` (NULL in service-role/pg_cron context) and `coalesce(request_device_id(), row.device_id)`. Precedent: auto-approve (#43c) and the retention job.
- Realtime publication carries `guests` and `check_ins` only; door (`door:${eventId}`) and cockpit (`eventday:${eventId}`) filter on `event_id`. A server-side insert with `event_id` set reaches both.
- `guests_autolink_contact` sets `contact_id` from the normalized e-mail; unique `(event_id, contact_id)` where not removed. A second guest row for the same e-mail collides — hence lines.
- pg_net persists request headers in `net.http_request_queue`, readable by `authenticated` on hosted Supabase: a kick never carries a secret (single-use token pattern from `20260925120100_push_dispatch_wiring.sql`).
- Vault: `public.push_dispatch_setting()` is the only reader today (owner-only, dynamic `execute`, NULL when Vault is absent).
- Weeztix (docs.weeztix.com, read 2026-10-07): bearer OAuth; resources company / event / eventdate / ticket_type ("ticket") / order / scanner; webhook triggers include `ticket: Scan`, `scanner: Scan`, `order: Paid|Placed`, `event: Update`, `ticket_type: Update`; orders go through the shop API (`GET …/reserve/ticket/:ticketGUID` → `POST …/:shopGUID/order` with `receiver{locale,email,firstname,lastname}`, `paymentProvider`, `currency`, `tickets[]`); Weeztix mails tickets by default. Webhook signing, scan payload shape and the zero-price payment method are **unverified** (page 404s) — see `weeztix.md`.

## 3. Data model

Migration timestamps are reserved here; check `git ls-files supabase/migrations | grep 202610` against `origin/main` before each merge.

### 3.1 `20261014100000_ticketing_core.sql` (Ticketing 1)

```sql
create type public.ticketing_provider as enum ('weeztix', 'stub');

create table public.ticketing_connections (
  id uuid primary key default public.uuid_generate_v7(),
  venue_id uuid not null references public.venues (id) on delete restrict,
  provider public.ticketing_provider not null,
  status text not null default 'connected' check (status in ('connected','needs_reauth','disconnected')),
  provider_account_id text not null check (char_length(provider_account_id) between 1 and 200),
  provider_account_name text check (provider_account_name is null or char_length(provider_account_name) <= 200),
  has_credentials boolean not null default false,          -- tokens live in Vault
  token_expires_at timestamptz,
  webhook_provider_id text,
  webhook_secret_hash bytea,                                -- sha256 of the path secret, never the secret
  connected_by uuid references public.user_profiles (id) on delete restrict,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, provider)
);

create table public.event_ticketing_links (
  id uuid primary key default public.uuid_generate_v7(),
  event_id uuid not null unique references public.events (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  connection_id uuid not null references public.ticketing_connections (id) on delete restrict,
  provider_event_id text not null,
  provider_event_name text,
  provider_meta jsonb not null default '{}'::jsonb,        -- weeztix: {eventDateGuid, shopGuid, paymentProviderGuid}
  status text not null default 'linked' check (status in ('linked','stale','unlinked')),
  linked_by uuid references public.user_profiles (id) on delete restrict,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, provider_event_id)
);

alter table public.guest_tiers
  add column ticket_mode text not null default 'none' check (ticket_mode in ('none','optional','required')),
  add column ticket_type_external_id text,
  add column ticket_type_name text,
  add constraint guest_tiers_ticket_type_required check (ticket_mode = 'none' or ticket_type_external_id is not null);
-- BEFORE INSERT/UPDATE trigger guest_tiers_ticket_requires_link: ticket_mode <> 'none' requires a 'linked'
-- event_ticketing_links row for new.event_id (SQLSTATE 45011). event_template_tiers is NOT extended.

alter table public.venues add column ticketing_enabled_at timestamptz;
-- column grants exclude it from authenticated (is_platform_admin pattern, 20260923120000);
-- set_venue_ticketing_enabled(p_venue_id, p_enabled) SECURITY DEFINER, requires is_platform_admin();
-- venue_ticketing_enabled(p_venue_id) SECURITY DEFINER helper for the RLS predicate.
```

RLS and grants (revoke first, then grant; no DELETE for any app role):

- `ticketing_connections`: SELECT = `has_venue_role(venue_id,'{admin}')` or `is_venue_organizer(venue_id)` (organizers need "is this venue connected?" for the tier form); INSERT = admin and `venue_ticketing_enabled(venue_id)` and `connected_by = auth.uid()`; UPDATE = admin. Column grants for `authenticated`: SELECT on everything except `webhook_secret_hash`; INSERT/UPDATE only on `venue_id, provider, status, provider_account_id, provider_account_name, connected_by, disconnected_at`. `has_credentials`, `token_expires_at`, `webhook_*` are written by service_role RPCs only. Soft delete = `status = 'disconnected'`.
- `event_ticketing_links`: SELECT = `is_venue_member(venue_id)` or `is_event_organizer(event_id)`; INSERT/UPDATE = admin with `linked_by = auth.uid()`.
- Audit: `create trigger audit_ticketing_connections … audit_trigger()` (venue-scoped else-branch works as is); `event_ticketing_links` added to the event-scoped `when` list of `audit_trigger()` (additive `CREATE OR REPLACE`, as in `20260706100000_influencers_request_links.sql`). `guest_tiers` is already audited, so `ticket_mode` changes land in the diff.

### 3.2 `20261014100100_guest_contact_names.sql` (Ticketing 1)

`guests.first_name`, `guests.last_name`, `contacts.first_name`, `contacts.last_name` (nullable, ≤100, trimmed CHECK). `public.split_full_name(text) returns table (first_name text, last_name text)` immutable: last whitespace token = last name, rest = first name; single token → first only. No backfill UPDATE (one audit row per guest otherwise). Consumers use `coalesce(first_name, (split_full_name(full_name)).first_name)`. `upsert_contacts` gains two optional args with NULL defaults (expand only).

### 3.3 `20261014100200_check_ins_source_provider_actor.sql` (Ticketing 1, high-risk)

```sql
alter table public.check_ins
  add column source text not null default 'door' check (source in ('door','cockpit','provider_scan'));
alter table public.check_ins alter column checked_by drop not null;
alter table public.check_ins
  add constraint check_ins_actor_or_provider check (checked_by is not null or source = 'provider_scan');

alter policy check_ins_insert on public.check_ins
  with check (
    source <> 'provider_scan'
    and public.can_record_check_in_for(public.guest_event(guest_id), checked_by)
    and (synced_by is null or synced_by = (select auth.uid()))
  );
-- guard_check_in_actor_change(): inside the client-role branch,
--   if new.source is distinct from old.source then raise 42501.
-- Column grants: authenticated may INSERT source (door/cockpit), never UPDATE it.
```

Same PR: `src/features/po/mutations.ts` cockpit insert sends `source: 'cockpit'`; door gateway/optimistic rows send `'door'` (or omit). Nullable ripple: `src/features/door/model.ts` (`checked_by ? name : 'Ticket scan'`), `src/features/door/queries.ts`, `src/features/po/queries.ts`, `src/features/po/adapters.ts`, `src/features/export/collect.ts` (skip NULL before profile fetch, export writes `ticket-scan`). `src/features/audit/translate.ts`: `check_ins` with NULL actor and a device starting with a provider prefix → actor "Ticket scanner". Regenerate `src/lib/database.types.ts`.

Rejected alternatives: a per-venue system user (needs `auth.users` rows, a unique e-mail, shows up in team/profile/retention); stamping the connecting admin (falsifies the audit trail, #45).

### 3.4 `20261015100000_ticketing_secrets_vault.sql` (Ticketing 2, high-risk)

`ticketing_secret_put(p_connection_id, p_kind, p_value)`, `ticketing_secret_get(p_connection_id, p_kind)`, `ticketing_secret_delete(p_connection_id)`, `ticketing_connection_mark_credentials(p_connection_id, p_has, p_expires_at, p_webhook_provider_id, p_webhook_secret_hash)` — all SECURITY DEFINER, `set search_path = ''`, `revoke … from public, anon, authenticated`, `grant execute … to service_role`. Secret name `ticketing:<connection_id>:<kind>`, kinds `access_token | refresh_token | webhook_secret`. Dynamic `execute` against `vault.create_secret / vault.update_secret / vault.decrypted_secrets`; NULL / typed error when Vault is absent so a Vault-less local stack still resets and the adapter falls back to the stub. `ticketing_secret_get` refuses a `disconnected` connection. Disconnect = user-scoped `status = 'disconnected'` + service `ticketing_secret_delete` + best-effort webhook deletion at the provider.

Trade-off recorded in #54(g): plaintext readable by the `postgres` role (SQL editor), by no app role. Upgrade path: app-level AES-GCM behind the same RPC signatures.

### 3.5 `20261016100000_ticket_lines_outbox.sql` (Ticketing 4, high-risk)

```sql
alter table public.guests add column ticket_requested boolean not null default false;  -- client-writable; optional tiers

create table public.guest_ticket_lines (
  id uuid primary key default public.uuid_generate_v7(),
  guest_id uuid not null references public.guests (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  link_id uuid not null references public.event_ticketing_links (id) on delete restrict,
  kind text not null check (kind in ('tier','extra')),
  ticket_type_external_id text not null,
  ticket_type_name text,
  quantity integer not null check (quantity between 1 and 60),
  quantity_issued integer not null default 0 check (quantity_issued >= 0),
  status text not null default 'pending'
    check (status in ('needs_email','pending','issuing','issued','failed','cancelled','over_issued')),
  provider_order_ids text[] not null default '{}',
  last_error text check (last_error is null or char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index guest_ticket_lines_tier_uidx on public.guest_ticket_lines (guest_id) where kind = 'tier';
create index guest_ticket_lines_event_status_idx on public.guest_ticket_lines (event_id, status);

create table public.guest_tickets (
  id uuid primary key default public.uuid_generate_v7(),
  line_id uuid not null references public.guest_ticket_lines (id) on delete restrict,
  guest_id uuid not null references public.guests (id) on delete restrict,
  event_id uuid not null references public.events (id) on delete restrict,
  connection_id uuid not null references public.ticketing_connections (id) on delete restrict,
  provider_ticket_id text not null,
  provider_order_id text,
  status text not null default 'issued' check (status in ('issued','cancelled')),
  scanned_at timestamptz,
  scanner_ref text,
  created_at timestamptz not null default now(),
  unique (connection_id, provider_ticket_id)
);

create table public.ticketing_outbox (
  id uuid primary key default public.uuid_generate_v7(),
  kind text not null check (kind in ('issue','cancel','refresh_token','register_webhook')),
  connection_id uuid not null references public.ticketing_connections (id) on delete cascade,
  line_id uuid references public.guest_ticket_lines (id) on delete cascade,
  dedupe_key text not null unique,            -- 'issue:<line_id>:<quantity>' / 'cancel:<ticket_id>'
  payload jsonb not null default '{}'::jsonb, -- ids only, never names or e-mail
  status text not null default 'pending' check (status in ('pending','sending','sent','skipped','failed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz, sent_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.ticketing_dispatch_tokens (token_hash bytea primary key, created_at timestamptz not null default now());
```

RLS: `guest_ticket_lines` / `guest_tickets` SELECT `using (exists (select 1 from public.guests g where g.id = guest_id))` — the sub-select runs under the caller's `guests_select`, so a line is visible exactly when its guest is. No INSERT/UPDATE/DELETE for `authenticated`; every write is a definer trigger or RPC. `ticketing_outbox`, `ticketing_dispatch_tokens`: RLS on, zero grants (the `notification_outbox` pattern).

Triggers and RPCs:

- `guests_ticket_lines_sync()` — AFTER INSERT OR UPDATE OF `tier_id, plus_ones, status, ticket_requested, email` ON `guests`, SECURITY DEFINER. Wish = tier `ticket_mode = 'required'` OR (`'optional'` AND `ticket_requested`). Wish ∧ e-mail ∧ status ∈ {approved, checked_in} → upsert the `tier` line (`quantity = 1 + plus_ones`, type from the tier); `quantity > quantity_issued` and status ≠ issuing → `pending` + enqueue `issue:<line>:<quantity>`. Wish ∧ no e-mail → `needs_email`, and for `source = 'app'` INSERT into a `required` tier → `raise … errcode '45010'`. Status → removed → `cancel` jobs for issued, unscanned tickets; lines → `cancelled`. Tier change to a different ticket type → cancel + fresh line. Body wrapped in `exception when others then raise warning` except the 45010 branch, so plumbing failures never cost a guest row (the backfill reconciles).
- Statement trigger on `ticketing_outbox` → `kick_ticketing_dispatch()` (copy of `notification_outbox_kick`).
- `request_tier_tickets(p_tier_id, p_dry_run boolean default true)` — SECURITY DEFINER, role check admin or `is_event_organizer`; returns `{eligible, missing_email, queued}`; preview and backfill in one function.
- `add_guest_ticket_line(p_guest_id, p_ticket_type_external_id, p_quantity)` / `cancel_guest_ticket_line(p_line_id)` — DEFINER, same gate as `canUpdateGuest` (`can_write_guests` + own row, or admin/doorhost/organizer), extras only (Ticketing 6).
- `retry_ticket_line(p_line_id)` — admin/organizer; `failed → pending` + kick.
- `claim_ticketing_outbox(p_token, p_limit)`, `complete_ticketing_outbox(p_id, p_outcome, p_error, p_tickets jsonb)`, `ticketing_outbox_sweep()`, `kick_ticketing_dispatch()`, `ticketing_dispatch_token_valid()`; pg_cron `plusone-ticketing-outbox-sweep` `*/2 * * * *`; daily prune of finished rows older than 30 days. The claim result joins line, guest (first/last/e-mail via `coalesce(first_name, split…)`), ticket type and link meta: the only place guest PII leaves the DB for the worker, and it never leaves the server.

Quota/lock: nothing reads lines in `enforce_guest_quota`, capacity or tier-max; lines are not slots (#22). List lock (#23) stops staff mutations and therefore new lines; admin backfill still works.

### 3.6 `20261017100000_ticketing_webhook_inbox.sql` (Ticketing 5, high-risk)

```sql
create table public.ticketing_webhook_events (
  id text primary key,                 -- '<connection_id>:<provider delivery id | sha256(body)>'
  connection_id uuid not null references public.ticketing_connections (id) on delete cascade,
  trigger text not null,
  outcome text not null check (outcome in
    ('applied','duplicate','unknown_ticket','already_counted','ignored','needs_fetch','voided')),
  provider_ticket_id text,
  received_at timestamptz not null default now()
);
-- RLS on, zero app grants.

create or replace function public.apply_ticket_scan(
  p_connection_id uuid, p_secret text, p_delivery_id text, p_trigger text,
  p_provider_ticket_id text, p_provider_order_id text, p_scanned_at timestamptz,
  p_scanner_ref text, p_direction text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_conn public.ticketing_connections; v_ticket public.guest_tickets; v_line public.guest_ticket_lines;
  v_arrived integer; v_id text := p_connection_id || ':' || p_delivery_id;
begin
  select * into v_conn from public.ticketing_connections where id = p_connection_id and status <> 'disconnected';
  if v_conn.id is null or v_conn.webhook_secret_hash is null
     or v_conn.webhook_secret_hash <> extensions.digest(p_secret, 'sha256') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- per-connection throttle via consume_public_throttle('tix:' || p_connection_id, 1, 600) → PT429

  insert into public.ticketing_webhook_events (id, connection_id, trigger, outcome, provider_ticket_id)
  values (v_id, p_connection_id, p_trigger, 'ignored', p_provider_ticket_id)
  on conflict (id) do nothing;
  if not found then return 'duplicate'; end if;

  if p_direction is distinct from 'in' then return 'ignored'; end if;   -- scan-out / undo: v1 ignores

  select * into v_ticket from public.guest_tickets
   where connection_id = p_connection_id and provider_ticket_id = p_provider_ticket_id and status = 'issued';
  if v_ticket.id is null then update … outcome = 'unknown_ticket'; return 'unknown_ticket'; end if;  -- a paid ticket, not ours
  if v_ticket.scanned_at is not null then update … 'already_counted'; return 'already_counted'; end if;

  update public.guest_tickets set scanned_at = coalesce(p_scanned_at, now()), scanner_ref = p_scanner_ref where id = v_ticket.id;
  select * into v_line from public.guest_ticket_lines where id = v_ticket.line_id;
  if v_line.kind <> 'tier' then update … 'applied'; return 'applied'; end if;   -- parking never checks anyone in

  select count(*) - 1 into v_arrived
    from public.guest_tickets t join public.guest_ticket_lines l on l.id = t.line_id
   where t.guest_id = v_ticket.guest_id and l.kind = 'tier' and t.scanned_at is not null;

  insert into public.check_ins (id, guest_id, checked_by, source, checked_at, client_timestamp, device_id,
                                plus_ones_arrived, offline_synced)
  values (public.uuid_generate_v7(), v_ticket.guest_id, null, 'provider_scan', coalesce(p_scanned_at, now()),
          p_scanned_at, v_conn.provider || ':' || coalesce(p_scanner_ref, 'scanner'), greatest(v_arrived, 0), false)
  on conflict (guest_id) do update
     set plus_ones_arrived = greatest(public.check_ins.plus_ones_arrived, excluded.plus_ones_arrived)
   where public.check_ins.voided_at is null;   -- doorhost-first → top-up only; checked-out guest → no revive in v1
  update public.ticketing_webhook_events set outcome = case when found then 'applied' else 'voided' end where id = v_id;
  return 'applied';
end $$;
revoke execute on function public.apply_ticket_scan(uuid,text,text,text,text,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.apply_ticket_scan(uuid,text,text,text,text,text,timestamptz,text,text) to service_role;
```

Side effects come from the existing triggers: `cap_check_in_arrivals` clamps to `guests.plus_ones`, `sync_guest_status_from_checkin` flips `approved → checked_in` (a `refused` guest stays `refused`, by decision), `set_checkin_scope` fills `event_id`/`venue_id`, the audit trigger writes actor NULL + the provider device id, realtime delivers to the door.

`apply_ticketing_webhook_event(...)` for non-scan triggers: `order: Paid|Placed` → stamp `provider_order_id` where missing; `event: Update` / `ticket_type: Update` → `event_ticketing_links.status = 'stale'` (UI offers Refresh); everything else → `ignored`. If a scan payload carries only an id, the route records `needs_fetch` and enqueues a `fetch_scan` job (adapter `fetchScan`).

## 4. Provider seam — src/features/ticketing (Ticketing 2)

```
provider.ts            TicketingProvider + TicketingCapabilities + wire types; ticketingProviderFor(provider)
config.ts              WEEZTIX_CLIENT_ID, WEEZTIX_CLIENT_SECRET, TICKETING_STUB (dev/CI), TICKETING_ISSUE_RPS (default 2)
registry.ts            weeztix → WeeztixAdapter (stub when keyless); stub → StubAdapter (non-prod only)
weeztix/adapter.ts     authorizeUrl, exchangeCode, refresh, account, listEvents (+eventdates, shops), listTicketTypes,
                       issueTickets (reserve ×qty → one order), cancelTickets, registerWebhook, deleteWebhook,
                       parseWebhook, verifyWebhook?
weeztix/schemas.ts     zod for every provider response and webhook body
stub/adapter.ts        in-memory: 2 events, 3 ticket types, deterministic ids, simulateScan()
connections.ts         server actions: startConnect, disconnect, listProviderEvents, importProviderEvent, linkEvent,
                       unlinkEvent, listTicketTypes
lines.ts               server actions: requestTierTickets(preview|run), addExtraLine, cancelLine, retryLine
dispatch.ts            runTicketingDispatch(req): token → claim → per job adapter call → complete (pure, testable)
webhook.ts             handleTicketingWebhook(provider, connectionId, secret, rawBody, headers) → RPC
ticketing-confinement.test.ts   copy of src/features/billing/stripe-confinement.test.ts: provider hosts and the
                       service client for ticketing only inside this directory
```

```ts
export interface TicketingCapabilities {
  events: boolean; ticketTypes: boolean; issueTickets: boolean; cancelTickets: boolean;
  scanWebhook: boolean; scanPolling: boolean; webhookSignature: 'hmac' | 'path-secret';
}
export interface TicketingProvider {
  readonly key: 'weeztix' | 'stub';
  readonly capabilities: TicketingCapabilities;
  authorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<Credentials>;
  refresh(creds: Credentials): Promise<Credentials>;
  account(creds: Credentials): Promise<{ id: string; name: string | null }>;
  listEvents(creds: Credentials): Promise<ProviderEvent[]>;
  listTicketTypes(creds: Credentials, link: LinkMeta): Promise<ProviderTicketType[]>;
  issueTickets(creds: Credentials, order: IssueOrder): Promise<IssueResult>;
  cancelTickets(creds: Credentials, ids: string[]): Promise<void>;
  registerWebhook(creds: Credentials, url: string): Promise<{ providerWebhookId: string }>;
  deleteWebhook(creds: Credentials, providerWebhookId: string): Promise<void>;
  parseWebhook(rawBody: string, headers: Headers): ParsedWebhook;
  verifyWebhook?(rawBody: string, headers: Headers, secret: string): boolean;
}
```

Every server action: `getUser()` → read the connection or link through the **user-scoped** client first (RLS proves admin/organizer) → only then the service client for secrets. Zod on every input and every provider response. Generic errors to the client, details to server logs. Connect and issue are billing-gated (`assertVenueBillingActive`).

Routes:

- `GET /api/ticketing/weeztix/connect?venue=<uuid>` — `getUser()`, zod, user-scoped admin check, billing gate, enabled gate, `state` = 32 random bytes in cookie `po_tix_state` (`{state, venueId}`, httpOnly, Secure, SameSite=Lax, 10 min), `302` to `authorizeUrl`. Full-page redirect; no popup, so the Capacitor webview follows it.
- `GET /api/ticketing/weeztix/callback?code&state` — `getUser()` again (logged-out → `/login?next=/app/integrations`), constant-time state compare, clear cookie, `exchangeCode`, `account()`, user-scoped upsert of `ticketing_connections`, service `ticketing_secret_put ×2`, enqueue `register_webhook`, `303 /app/integrations?connected=weeztix`. Errors → `?error=connect` (generic).
- `POST /api/webhooks/ticketing/weeztix/[connectionId]/[secret]` — middleware exempt (`/api/webhooks/`), raw body, `parseWebhook`, service RPC. `200 {ok:true}` for duplicate/unknown/ignored, `401` only for a bad secret, `429` on `PT429`. Path secret = 32 bytes hex, stored as sha256. HMAC verification added on top when Weeztix signs.
- `POST /api/internal/ticketing/dispatch` — middleware exempt (`PUBLIC_PREFIXES` += `/api/internal/ticketing/`), `runtime = 'nodejs'`, `maxDuration = 60`, single-use token, batch ≤ 20 jobs, sequential per connection, paced at `TICKETING_ISSUE_RPS`. Vault setting `plusone_ticketing_dispatch_url`.

## 5. Pipelines

**Issue:** guest added (`addGuest` / `addGuestsBulk` / quick-add) with `ticket_requested` and names + e-mail → `guests_ticket_lines_sync` creates the tier line + job → statement trigger kicks pg_net → dispatch route → `claim_ticketing_outbox` → per connection `ticketing_secret_get` (refresh when `token_expires_at < now() + 5 min`, write back) → `issueTickets` → `complete_ticketing_outbox` inserts `guest_tickets` rows and sets `quantity_issued`, `provider_order_ids`, status `issued`. Retry on 5xx/timeout with backoff `2^n` minutes, max 5 → `failed` + `last_error` code; immediate `failed` on 4xx (`provider_rejected`). The guest row shows the badge; admin/organizer get Retry and "Add e-mail" (editing the guest re-evaluates the trigger). +N increase → `quantity` up, `pending`, delta job (dedupe key includes the quantity). Removal → cancel unscanned; scanned stay (the person is inside). Retroactive: tier saved with mode ≠ none while guests exist → preview via `request_tier_tickets(p_dry_run := true)` → run.

**Scan:** webhook → route → `apply_ticket_scan` → `check_ins` insert or top-up → status sync → realtime to door and cockpit. Door UI renders a NULL `checked_by` as "Ticket scan". Conflicts: doorhost first → top-up only; scan first → the door's own tap becomes `duplicate` (existing replay semantics, "Already checked in on another device"); checked-out (voided) guest scanned again → ledger `voided`, no revive in v1; refused guest → row inserted, status stays `refused`.

## 6. UI

Every new screen touches: `ScreenName` union (`src/components/po/context.tsx`), `screenPath`/`parseAppUrl` (`src/components/po/routes.ts` + `routes.test.ts`), `navKeyForScreen`/`parentPathFor`/`WIDE_DESKTOP` (`src/components/po/nav-map.ts`), lazy `dynamic()` + `case` in `src/components/po/app-screens.tsx`, a More-hub `Row` gated on `caps.ticketing` (`src/components/po/screens/settings.tsx`), strings under `t.ticketing.*` in `src/lib/i18n/en.ts`. Capacitor checklist per screen: client-side reads via `src/features/po/hooks.ts`, writes via server actions (nothing here is offline-critical), connect = full-page redirect, external links via the kit's `openExternal()`, works at 641–1023, no billing UI.

- **A `integrations`** (`/app/integrations`, admin + enabled): provider cards (Connect / Connected as {account} since {date} / Disconnect; Stub only outside production), last error, "Import an event" picker → `importProviderEvent` → `createEvent` + link → event edit.
- **B `eventticketing`** (`/app/events/:id/ticketing`, row in `src/components/po/screens/events/edit.tsx` beside Tiers/Crew, admin/organizer): link state, "Link to a Weeztix event" (event + eventdate + shop + payment method), Unlink, Refresh (stale), line counts by status, "Issue missing tickets" (preview → run).
- **C Tier form** (`src/components/po/screens/events/tier-form.tsx`, `src/features/events/tier-form.ts`, `createTierSchema`/`updateTierSchema` in `src/features/events/schemas.ts`): when linked, segmented `Ticket: none / optional / required` + ticket-type select (stored id + name), superRefine; saving optional/required on a tier with guests → backfill preview.
- **D Guest add** (`src/components/po/screens/guests/quick-add.tsx` `executePlan`, bulk sheet, door add): optional → "Send ticket" toggle (on when an e-mail is known); required → first/last name + e-mail mandatory (`fullName` derived), `z.string().email()` on this path only; door add: no toggle, `needs_email` silently. The `Tier` domain type gains `ticketMode`/`ticketTypeName`; `fetchTiers` selects the two columns.
- **E Guest row + profile**: badge from the lines embed on `fetchGuests` (`src/features/po/queries.ts`); `profileRowActions()` (`src/features/guests/permissions.ts`) gains `manageTickets` (same gate as `editPlusOnes`); sheet in `src/components/po/screens/guests/profile-event-actions.tsx`: lines, Retry, Add extra ticket, Cancel extra.
- **F Bulk/CSV grouping** (Ticketing 6): `groupTicketRows()` beside `src/features/contacts/import/parse.ts` (reuse `normalizeEmail`): rows sharing an e-mail → one guest; tier = the row whose ticket type matches a tier with mode ≠ none, others → extra lines. Unit-tested, wired into the bulk preview.

## 7. PR sequence

| # | Task | Scope | Gate |
|---|---|---|---|
| 0 | Ticketing 0 | Spec #54, CLAUDE.md, this folder. | — |
| 1 | Ticketing 1 | `20261014100000/100100/100200`, types regen, nullable ripple, `source` on both insert sites, audit label; pgTAP `ticketing_core`, `check_ins_provider_actor`, grant_matrix. | fresh `/code-review` + `/security-review` |
| 2 | Ticketing 2 | `20261015100000`, seam + Weeztix + stub, confinement test, connect/callback, screen A, `caps.ticketing`, platform toggle, flow `ticketing-connect`. | both reviews |
| 3 | Ticketing 3 | Screen B, tier form C, event list/import/link actions, 45011, pgTAP `ticketing_links`. | code-review |
| 4 | Ticketing 4 | `20261016100000`, lines/tickets/outbox/triggers, dispatch route, UI D + E, backfill; pgTAP `ticket_lines`, `ticketing_outbox`; Vitest `dispatch.test.ts`; flow add guest → issued. | both reviews |
| 5 | Ticketing 5 | `20261017100000`, webhook route, `apply_ticket_scan`; pgTAP scan matrix; Vitest `parseWebhook`; flow scan → door. | both reviews |
| 6 | Ticketing 6 | Extras UI + RPCs, bulk grouping, `upsert_contacts` name args; Vitest `groupTicketRows`, `splitFullName`. | code-review |
| 7 | Ticketing 7 | Prod switch-on runbook (§9). | manual |

1→2→3→4→5 sequential; 6 after 4; 0 anytime. Every branch starts with `git pull --ff-only origin main`.

## 8. Tests

- pgTAP, allowed **and** denied per role (admin, finance, user_manager, staff, doorhost, organizer, other-venue admin, anon, platform admin): connection insert needs admin + enabled flag; organizer reads, cannot insert; `webhook_secret_hash` invisible to `authenticated`; links admin-only write, organizer read; `guest_tiers` 45011 when unlinked; lines visible iff the guest is (staff own-row vs other staff); no app role inserts lines/tickets/outbox/ledger; `check_ins_insert` rejects `source = 'provider_scan'` and NULL `checked_by` for every role; client UPDATE cannot change `source`; `apply_ticket_scan` not executable by `authenticated`; grant_matrix green.
- Behavioural pgTAP: 45010 for app insert into required tier without e-mail; door insert → `needs_email`, no error; +N → delta job with a distinct dedupe key; removal → cancel jobs only for unscanned; scan sequence (first = insert with `plus_ones_arrived 0`, second = 1, clamp at `plus_ones`, doorhost-first = top-up only, voided = no change, refused = row + status unchanged, duplicate delivery id = no second write, audit row with NULL actor + provider device, `guests.status` flipped once).
- Vitest: adapter request/response fixtures; `parseWebhook`; dispatch loop with a fake provider (success, 5xx retry, 4xx fail, token refresh written back); OAuth state round-trip with a mocked Supabase client; confinement; `splitFullName`; `groupTicketRows`; `routes.test.ts` for the two screens; translate label.
- Flows (`tests/flows/ticketing.flow.ts`, registered in `tests/flows/flows.mjs`): connect stub → import event → tier required → quick-add with names + e-mail → badge "Issued 2" (dispatch invoked through the route with a harness-minted token) → `simulateScan` → door shows the guest inside as "Ticket scan".
- Per PR: `pnpm lint`, `tsc`, `pnpm test`, `supabase db reset && pnpm db:test`, `pnpm qa:flows ticketing`, prod-push `--dry-run` for 1/4/5.
- Security-research prompts at the wrap-up of Ticketing 1, 2, 4, 5 (foothold + code inline + concrete questions): (a) OAuth state fixation/reuse, a staffer completing an admin's callback, any PostgREST role reaching `vault.decrypted_secrets` or the secret RPCs, token echo in error paths; (b) what one stolen single-use dispatch token buys, replay → duplicate orders, crafted `payload` reaching the adapter unvalidated, claim/complete driven by `authenticated`; (c) a valid secret of connection A checking in a guest of venue B (lookup is connection-scoped — prove it), a forged payload voiding or altering a door check-in, ledger flooding, timing of the secret compare, PII in logs.

## 9. Runbook — switching Weeztix on (Ticketing 7)

1. Weeztix app credentials from apiteam@weeztix.com; redirect URI `https://app.plus-one.io/api/ticketing/weeztix/callback`. Vercel env: `WEEZTIX_CLIENT_ID`, `WEEZTIX_CLIENT_SECRET`.
2. Vault (SQL editor, as for push): `select vault.create_secret('https://app.plus-one.io/api/internal/ticketing/dispatch', 'plusone_ticketing_dispatch_url');`
3. Prod-push per CLAUDE.md (pull, reset + `pnpm db:test`, dry-run, push).
4. `select public.set_venue_ticketing_enabled('<venue uuid>', true);` as a platform admin.
5. Venue admin: More → Integrations → Connect Weeztix → Import or link an event → tier `required` with the guest-list ticket type → add a test guest with names + e-mail → ticket arrives → scan with a real Weeztix scanner → guest turns green on the door as "Ticket scan" → `audit_log` row with NULL actor and `weeztix:<scanner>`.
6. Reading the ledger: `select outcome, count(*) from ticketing_webhook_events where connection_id = … group by 1;` and `select status, count(*) from ticketing_outbox group by 1;`.

## 10. Open questions (first mail to Weeztix; do not block Ticketing 0–1)

1. Webhook authentication: signature header or none (path secret is the fallback the design assumes).
2. `ticket: Scan` payload: inline ticket/order/scanner GUIDs, timestamp, direction — or id-only (`needs_fetch` path exists).
3. Zero-price order: which `paymentProvider` GUID, or a complimentary/guest-list endpoint that skips the 8-minute reservation dance (decides whether `issueTickets` is 1 + N calls or 1 call).
4. Shop per event: can PlusOne create a hidden guest-list shop via API, or is a dashboard step required.
5. OAuth app credentials, redirect-URI registration, scopes, refresh lifetime, multi-company accounts (`provider_account_id` already models a company picker).
6. Rate limits for order creation.

## 11. Parked (milestone)

- CM.com (`scanPolling` worker on pg_cron, 5 r/s budget), Paylogic, Stager, Celebratix, WeTicket adapters — ≥5.
- PlusOne-sent ticket mail for providers that return a barcode but do not mail (`MailProvider`, new `mail_log.type`) — ≥5.
- Fuzzy match guest list ↔ paid ticket buyers + conflict flag (#36) — ≥25.
- Scan-out / undo / re-entry, provider-side check-out — ≥5.
- Ticket link on `event_template_tiers` / `create_event_from_template` — ≥5.
- Multiple connections per venue/provider, multiple providers per event — ≥25.
- Platform-tab view of `ticketing_webhook_events` / outbox health — ≥5.
- Reading paid buyers into the list — not planned (what #54 replaces).
