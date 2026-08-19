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
# 1. Is the DSN in the shipped bundle? NEXT_PUBLIC_* is inlined at build time,
#    so absence here proves it was unset for that build.
curl -s https://plus-one-phi.vercel.app/ \
  | grep -o '/_next/static/chunks/[a-zA-Z0-9._/-]*\.js' | sort -u \
  | while read -r c; do curl -s "https://plus-one-phi.vercel.app$c"; done \
  | grep -c 'ingest.*sentry\.io'          # 0 = Sentry is NOT reporting

# 2. The same-origin tunnel only exists once the SDK initialises with a DSN.
curl -s -o /dev/null -w '%{http_code}\n' https://plus-one-phi.vercel.app/monitoring
                                          # 404 = SDK never initialised
```

`pnpm build` now refuses a `VERCEL_ENV=production` build with the DSN (or
`LANDING_IP_SALT`, or the Supabase vars) missing — see
`scripts/hooks/lib/required-env.mjs`. So this failure mode should not recur; the checks
above are for confirming that, and for any environment the guard doesn't cover.

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
| Prod domain | `plus-one-phi.vercel.app` (app at `/app`) |
| Vercel project | `plus-one` (org `the-operators`, region `fra1`) |
| Supabase project | `tolxwgqhppdcvnogdpel` (`eu-west-1`, Pro, daily backups 7d) |
| Auth mail | Supabase Auth (check Auth → SMTP; watch default-SMTP rate limits) |
| Status pages | [Vercel](https://www.vercel-status.com) · [Supabase](https://status.supabase.com) |
