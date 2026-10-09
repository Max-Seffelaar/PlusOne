# Incident runbook — one page

For 00:30 moments. Stay calm, triage top-down, fix the smallest thing first.
Detailed restore steps: [backup-restore.md](backup-restore.md).

## First 60 seconds

1. **What's broken?** App won't load / door check-in fails / login fails / billing.
2. **Who's affected?** One venue or everyone? Mid-event (door open) or planned?
   → A live door during an event is **P1**: the door PWA works **offline** — tell
   staff to keep scanning; the outbox syncs when service returns. Don't panic-restore.
3. **Recent change?** Check the last Vercel deploy and the last merged PR. Most
   incidents are the last thing that shipped → **roll back first, diagnose later.**

## Triage table

| Symptom | Check | Fix |
|---|---|---|
| **App down / 500s** | [Vercel dashboard](https://vercel.com) → prod deployment (region `fra1`). [Supabase status](https://status.supabase.com). | If the last deploy is bad → Vercel → Deployments → previous good one → **Promote to Production** (instant rollback). |
| **App up but data errors** | Supabase Dashboard → prod `tolxwgqhppdcvnogdpel` → **Database health / Logs**. Check for exhausted connections, failed migration. | Restart DB if pooler is stuck. If a migration corrupted data → [backup-restore.md](backup-restore.md) real-incident restore. |
| **Login broken (no OTP mail)** | Supabase → **Auth → Logs** and **Auth → Email/SMTP settings**. Are OTP mails sending? Rate-limited? | If default Supabase SMTP is rate-limited, wait/limit blast. For a single stuck user, admin can `generate_link` from the dashboard. |
| **Door check-in not syncing** | Is it one device or all? Browser console on the device. | Single device offline = expected; outbox syncs on reconnect. All devices = treat as "App down". Never tell staff to stop scanning. |
| **Billing / webhook** | Supabase → `stripe_webhook_events` ledger; Stripe Dashboard → webhook deliveries. | Webhook failures do **not** block the door or data. Replay the event from Stripe; the ledger is idempotent. Non-urgent — can wait for morning. |
| **Platform digest didn't arrive** (07:45 mail to the platform admins) | Supabase → Edge Functions → `platform-digest` → Logs (`done` line with `sent`/`failed`, or `mail_not_configured`); `select status, error_code from mail_log where type = 'platform_digest' order by created_at desc limit 4;`. | There is one effective run per day, so a **failed** send is never retried on its own. Retry by hand in the SQL editor: `select public.kick_platform_digest();` (only `failed` recipients get a new attempt; anyone already sent gets nothing). A row stuck at `queued` blocks that day; tomorrow's run is unaffected. Non-urgent, internal mail only. Details: [mail-deliverability.md](mail-deliverability.md) "Platform digest". |
| **DB fully down / corrupt** | Supabase status + Database health. | [backup-restore.md](backup-restore.md) → "Real incident: restoring prod". Accept the data-loss window since last daily backup. Communicate it. |

## Is monitoring even alive? (30 seconds)

Don't read "no Sentry alerts" as "nothing is wrong" until you've confirmed Sentry is
reporting at all. It ran dead for at least 90 days without anyone noticing — the
build-time half worked on every deploy (source maps uploaded, releases stamped) while
the runtime half was off, because `sentry.*.config.ts` initialises with
`enabled: Boolean(dsn)` and `NEXT_PUBLIC_SENTRY_DSN` was never set in Vercel
(86eyp5w32). Everything looked configured; nothing reported.

Two checks, neither needs dashboard access:

```bash
APP=https://app.plus-one.io   # until that domain is attached: https://plus-one-phi.vercel.app

# 1. Is the DSN in the shipped bundle? NEXT_PUBLIC_* is inlined at build time,
#    so absence here proves it was unset for that build.
curl -s "$APP/" \
  | grep -o '/_next/static/chunks/[a-zA-Z0-9._/-]*\.js' | sort -u \
  | while read -r c; do curl -s "$APP$c"; done \
  | grep -c 'ingest.*sentry\.io'          # 0 = Sentry is NOT reporting

# 2. The same-origin tunnel only exists once the SDK initialises with a DSN.
curl -s -o /dev/null -w '%{http_code}\n' "$APP/monitoring"
                                          # 404 = SDK never initialised
```

`pnpm build` now refuses a `VERCEL_ENV=production` build with the DSN (or
`LANDING_IP_SALT`, or the Supabase vars) missing — see
`scripts/hooks/lib/required-env.mjs`. So this failure mode should not recur; the checks
above are for confirming that, and for any environment the guard doesn't cover.

## Sentry triage — what belongs in Sentry and what doesn't

Rule: **an issue in Sentry means someone should look at it.** Expected user-facing failures are not issues.
The gate is `captureUnexpectedError` (`src/lib/observability/capture.ts`, wired into the `/app` query and
mutation caches in `PoLiveProvider`); everything else goes through it.

| Failure | In Sentry as | Why |
|---|---|---|
| Known user-facing MutationError (`42501`, `23505`/`exists`, `invalid_input`, `already_handled`, quota `4500x`, `billing_*`, URL validation copy) | Breadcrumb (`expected-error`) on the next real event | The UI already told the user; it is a rule, not a bug. |
| Unknown MutationError code (`unknown`, `invite`, …) | Issue | May be a bug. Add the code to `EXPECTED_CODES` in `src/lib/db-errors.ts` only once you have confirmed it is user-facing. |
| Supabase `PostgrestError` (object) | Issue titled with the DB message, tag `db_code`, hint in extra (never `details`: can echo row values) | Previously "Object captured as exception with keys…", all grouped as one. A raw `42501` here is an RLS denial the UI should not have attempted — keep it visible. |
| `Load failed` / `Failed to fetch` / `AuthRetryableFetchError` while `navigator.onLine === false` | Nothing | Door/outbox handle offline by design. |
| Same errors while online | Issue with tag `network:true` | A real connectivity or CORS/CSP problem; filter on the tag when triaging. |
| `AbortError` | Nothing | Cancelled request. |

Triage a new issue: (1) title says `PostgrestError`? read `db_code` + `hint`, then the query key in extra;
(2) `network:true` cluster on one release/browser? check CSP and the Supabase status; (3) a user-facing message
showing up as an issue means it is missing from `EXPECTED_MESSAGES`/`EXPECTED_CODES` — add it with a test in
`capture.test.ts`. Never filter on a hunch: read one stack first.

## Rollback = the default first move

Vercel deploys are immutable and instant to promote. If anything broke right after
a deploy, **promote the previous production deployment** before debugging. Schema
changes can't roll back this way — never `db push` a fix at 00:30 unless the app
is already down and you've rehearsed it against a restored copy.

## Who to inform

- **Pilot venue contacts:** `<FILL IN — name + phone/WhatsApp per pilot venue>`.
  A live-event incident: message them proactively. A planned-event or billing
  hiccup: a morning note is fine.
- **Escalation / on-call:** Max (`<phone>`).
- Keep messages factual: what's affected, what you're doing, expected ETA. No PII
  in any channel.

## Key facts (fill the gaps once)

| Thing | Value |
|---|---|
| Prod domain | `app.plus-one.io` (app at `/app`); the Vercel URL `plus-one-phi.vercel.app` keeps working as a fallback |
| Marketing site | `plus-one.io` (canonical; `www` redirects to the apex). Separate repo `Plus-One.io`, Vercel project `plus-one-io` |
| Vercel project | `plus-one` (org `the-operators`, region `fra1`) |
| Supabase project | `tolxwgqhppdcvnogdpel` (`eu-west-1`, Pro, daily backups 7d) |
| Auth mail | Supabase Auth (check Auth → SMTP; watch default-SMTP rate limits) |
| Status pages | [Vercel](https://www.vercel-status.com) · [Supabase](https://status.supabase.com) |
