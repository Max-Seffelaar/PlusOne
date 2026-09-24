# Push dispatch — deploy, secrets, and how to check it (Fase 17 N2)

Pipeline: `quota_requests` / `guest_requests` AFTER-triggers → `notification_outbox`
→ pg_net → Edge Function **`push-dispatch`** → FCM HTTP v1 → the device.
pg_cron retries (`plusone-push-outbox-sweep`, every 2 min) and prunes tokens
(`plusone-push-token-prune`, daily 03:17 UTC). Design: `capacitor-plan-claude-code.md` §3;
decision #50 in `gastenlijst-app-spec.md`.

**Nothing here goes into Vercel.** The Next.js app never sends push; only the Edge
Function does, so the FCM credential stays out of every Vercel bundle and log.

## Asleep until configured

After the migrations are pushed, the pipeline is **live-but-sleeping**:

- the triggers fill `notification_outbox` (rows stay `pending`);
- `kick_push_dispatch()` returns `false` (no Vault config → no HTTP call);
- `claim_push_outbox()` refuses every caller (no invocation token was ever issued);
- no client registers tokens yet (that is N5), so even a woken pipeline would
  mark rows `skipped`.

Nothing breaks and nothing is sent. Local stacks and CI stay in this state.

## Turning it on (prod) — once, from the linked main checkout

Order matters: function + FCM secrets first, the Vault URL last.

### 1. Edge Function secrets (FCM)

Dashboard → Project Settings → Edge Functions → Secrets, or from the linked checkout:

```sh
supabase secrets set FCM_PROJECT_ID=<firebase-project-id>
supabase secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat path/to/service-account.json)"
```

`FCM_SERVICE_ACCOUNT_JSON` is the **complete** service-account JSON as one value
(from the password manager; never the repo). `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by the Edge runtime — don't set them.

### 2. Deploy the function

```sh
supabase functions deploy push-dispatch --no-verify-jwt
```

`verify_jwt = false` is also pinned in `supabase/config.toml`; the flag makes it
explicit. The caller (pg_net) holds no user JWT, and a gateway JWT check would pass
with the public anon key anyway. The real gate is a **single-use token**: every kick
mints a fresh random 256-bit token, stores only its sha256, and sends it as the
`x-push-dispatch-token` header; `claim_push_outbox()` consumes it (10-minute
lifetime) before any row is touched. Nothing to generate, store or rotate.

Why not a static shared secret: pg_net keeps each request, headers included, in
`net.http_request_queue` until it is sent, and Supabase grants `anon`/`authenticated`
access to schema `net` (a platform grant `postgres` cannot revoke — CI proved it). A
token read from there is worth at most one early drain of already-queued rows.

### 3. Vault secret — the on-switch

SQL editor (prod):

```sql
select vault.create_secret(
  'https://tolxwgqhppdcvnogdpel.supabase.co/functions/v1/push-dispatch',
  'plusone_push_dispatch_url');
```

Set it via the SQL editor, never in a migration.

**Switch off again:** `delete from vault.secrets where name = 'plusone_push_dispatch_url';`
The outbox keeps filling; nothing is sent.

## How to check it

```sql
-- what the triggers queued (newest first)
select created_at, kind, status, attempts, last_error, recipient_user_id, payload
from public.notification_outbox order by created_at desc limit 20;

-- pipeline health at a glance
select status, count(*) from public.notification_outbox group by status;

-- is it configured? (true = a request was queued)
select public.kick_push_dispatch();

-- did pg_net reach the function? Status / body:
--   200                          drained (counts in the body)
--   401 invalid_token            the kick's token was unknown, used or expired (>10 min
--                                between kick and delivery) — not a config problem
--   502 service_key_rejected     PostgREST refused the function's SUPABASE_SERVICE_ROLE_KEY
--                                (runtime-injected: redeploy the function; nothing in Vault)
--   503 fcm_not_configured       FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_JSON missing or unparsable
--   500 misconfigured            SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absent in the runtime
select id, status_code, left(content::text, 200), created
from net._http_response order by created desc limit 10;

-- cron jobs present?
select jobname, schedule, active from cron.job where jobname like 'plusone-push-%';

-- registered devices (N5 onwards)
select transport, count(*) from public.push_tokens group by transport;
```

To see the outbox fill without touching real data, file a quota request as a staff
member in the app (or on a local stack), then run the first query: one `pending` row
per venue admin. Approve it: one `quota_request_decided` row for the requester.

Function logs: Dashboard → Edge Functions → push-dispatch → Logs. They contain
counts and error **codes** only — never device tokens, the service-account JSON,
or the invocation token.

## Outcomes and retries

| outbox status | meaning |
|---|---|
| `pending` | due (or backing off until `next_attempt_at`) |
| `sending` | claimed by an invocation; back to `pending` after 5 min if that invocation died |
| `sent` | delivered to at least one device |
| `skipped` | nothing to deliver to (no live FCM token, or every token pruned) |
| `failed` | 5 attempts used, or a permanent FCM error (bad request, not a bad token) |

Backoff: 2, 4, 8, 16 min. Tokens FCM reports as `UNREGISTERED`,
`SENDER_ID_MISMATCH` or an invalid registration token are deleted immediately.
Finished outbox rows are dropped after 30 days.
