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
- no device can register a token until the Android build carries
  `google-services.json` (N5 ships the client, but without Firebase config the
  app never asks), so even a woken pipeline would mark rows `skipped`.

Nothing breaks and nothing is sent. Local stacks and CI stay in this state.

## Go-live order (who does what)

Push works end to end only after all five steps. Each one is harmless alone.

0. **Schema — after the N5 merge, from the linked main checkout.**
   `20260925160000_push_tokens_last_seen_server_stamp.sql` through the prod-push
   flow (CLAUDE.md "Env & prod-push"). The N5 client no longer sends
   `last_seen_at`; without this migration an active device's row would age into
   the 90-day sweep (it re-registers on the next start, but loses delivery until
   then).
1. **Firebase client config in the repo — Max, then a PR.** Firebase console →
   project settings → Android app `app.plusone.guestlist` → download
   `google-services.json` → commit it at `android/app/google-services.json`
   (a client identifier, not a secret; plan decision 13). Rebuild the Android
   app. Before this, `android/app/build.gradle` skips the google-services plugin,
   the app reports push as unsupported and never shows the ask.
2. **FCM Edge secrets — Max.** Step 1 below (`FCM_PROJECT_ID`,
   `FCM_SERVICE_ACCOUNT_JSON`).
3. **Deploy the function — Max, from the linked main checkout.** Step 2 below.
4. **Vault URL, the on-switch — Max, SQL editor.** Step 3 below. Last on purpose:
   from this moment the triggers' rows are sent.

From step 1 on, devices register tokens (rows appear in `push_tokens`) even
while the pipeline still sleeps; nothing is sent until step 4.

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
-- A long drain can outlast pg_net's 60 s timeout and show up here as a timeout
-- with no status: for long drains the function logs are the source of truth, not
-- net._http_response.
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

## The client (Fase 17 N5)

Code: `src/features/notifications/` (provider seam, `CapacitorPushProvider`,
`push-client.ts`) + `src/components/po/push-client.tsx` (chrome hook: register,
taps, foreground toast, the ask card) + `push-settings-card.tsx` (Profile toggle).
Decision #51 in `gastenlijst-app-spec.md`.

- **Where it runs.** Native shell, Android only. Web and SSR get the no-op
  provider; iOS reports `unsupported` until S1b (the plugin gives an APNs token
  there, and dispatch only speaks FCM).
- **No Firebase, no crash.** The push plugin's `register()`/`unregister()` crash
  the app natively when there is no `google-services.json`. The web side asks
  the local `PlusOnePushConfig` plugin (`android/app/src/main/java/app/plusone/guestlist/PushConfigPlugin.java`)
  first and never reaches those calls when the answer is no.
- **Asking.** Never at launch. ~8 s after the shell mounts, off the Deur tab, for
  admins, event organizers and staff only, and only while nothing was decided on
  this device: an explain-first card; the OS prompt (Android 13+
  `POST_NOTIFICATIONS`) appears only after "Turn on". Android 12 and below grant
  the permission from install, so the card is the consent step there too — a
  device is never registered on the OS grant alone. "Not now" snoozes 14 days;
  a denial is final for the card (recorded on the device, because Android 13+
  still reports a first "Don't allow" as askable). Profile → Security →
  "Push notifications" turns it on/off for this device (or explains the OS
  setting when Android blocks the prompt).
- **Device state.** `po:push` (`on` / `declined` / `off` / `off-pending`),
  `po:push-ask-snooze` and `po:push-row` (the stored row's uuid) in
  localStorage — all PII-free, all wiped on sign-out.
- **Register.** Plain upsert into `push_tokens` on `(transport, token)` with the
  user's own session: body = `transport`, `token`, `device_label` (the platform,
  `android`). Never `user_id`/`session_id`/`last_seen_at` — the defaults and the
  `push_tokens_stamp` trigger fill them from the JWT and the server clock
  (`last_seen_at := now()` on INSERT and UPDATE since
  `20260925160000_push_tokens_last_seen_server_stamp.sql`). The upsert returns
  the row `id`, remembered on the device. Re-run on every app start while `on`
  (the conflict UPDATE refreshes `last_seen_at`) and on every FCM token refresh;
  the same token is stored once per app run.
- **Unregister.** Rows are deleted by the session's `session_id` and by the
  remembered row `id` — never by token: a DELETE's filter is its query string,
  and the API gateway logs query strings. `signOutDevice`: the row delete runs
  after the outbox gate and before `auth.signOut()`, capped at 3 s and aborted at
  the cap (nothing of it runs later); the FCM token is invalidated only once the
  session is confirmed gone, right before the wipe. On `sign-out-incomplete`
  push is re-registered and the FCM token is never touched. `scope: 'global'`
  does not delete the other devices' rows (GoTrue ends those sessions
  directly); they are inert and the daily prune drops them.
- **Profile row.** Same role gate as the ask card (`canReceivePush`: admin, staff,
  event organizer). A turn-on whose token could not be stored yet (FCM or the
  network silent) keeps `on`, says it finishes later, and every start retries.
- **Profile "off".** Records `off-pending`, deletes the rows, invalidates the FCM
  token, and settles to `off` only when the delete succeeded. Offline the row
  shows that it could not reach the server, and every app start retries the
  delete until it goes through; a late token can never recreate the row while
  off.
- **Tap.** Payload `kind` + ids → `/app/requests/quota?event=…` (quota created /
  decided) or `/app/requests?event=…` (guest request). Cold start works: the
  plugin retains the tap until the web app's listener attaches. A notification
  for another venue goes through the chrome's venue switch, landing on the
  target; a refused switch stays where it is and says so.
- **Foreground.** No system banner (`presentationOptions: []` in
  `capacitor.config.ts`); the app shows its own toast.
- **Android bits.** Channel `approvals` (created by the app, named as FCM's
  default in the manifest), small icon `@drawable/ic_stat_plusone` (placeholder
  plus glyph until S2), accent tint `#B5A6FF`.

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
