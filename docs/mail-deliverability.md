# Mail deliverability — login OTP (Prod-ready 9/7 — task 10)

**Why this matters:** login is 100% e-mail (OTP code + invite/magic links, decision #20).
If auth mail lands in spam or bounces, **login is down**. This doc records what sends
prod mail today, how the sending domain is authenticated, and the evidence that it
actually delivers. Verified 2026-07-09.

## Verdict: 🟢 green, proven in production

Prod auth mail is sent through **Resend** (SMTP) from **`theoperators.nl`**, an
Operators-owned domain that is fully verified in Resend with correct SPF/DKIM/DMARC.
Real testers on Gmail, Hotmail and business domains all received their mail in the
inbox. Nothing to fix for launch. The remaining items are scale-time, not now.

## What sends prod mail

- **Provider:** Resend, wired as Supabase Auth's **custom SMTP** (not the built-in
  shared Supabase mailer). Supabase only generates the OTP/invite/magic-link mails;
  Resend transports them via Amazon SES **eu-west-1**.
- **Sending domain:** `theoperators.nl` — Resend domain status **verified**, sending
  **enabled**, region **eu-west-1**. This is a *borrowed* Operators domain "for now";
  a dedicated PlusOne sending domain is the F3 branded-mail work (ClickUp 86ey6b3hv).
- **App origin at time of check:** `https://plus-one-the-operators.vercel.app` (still
  the Vercel domain — no custom PlusOne app domain yet; also part of F3/branding).
- **Data residency:** everything stays in the EU — Supabase (Ireland), Resend/SES
  (eu-west-1), Sentry (EU), Vercel (fra1). Consistent.

## DNS authentication (verified via public resolver + Resend)

Checked over DNS-over-HTTPS (`dns.google`) to bypass the local ISP resolver, and
cross-checked against Resend's domain record:

| Record | Value | Result |
|---|---|---|
| DKIM `resend._domainkey.theoperators.nl` | 1024-bit RSA public key published | ✅ |
| SPF `send.theoperators.nl` | `v=spf1 include:amazonses.com ~all` | ✅ (Resend return-path) |
| Bounce MX `send.theoperators.nl` | `feedback-smtp.eu-west-1.amazonses.com` | ✅ EU region |
| DMARC `_dmarc.theoperators.nl` | `v=DMARC1; p=none;` | ⚠️ present, monitor-only, no `rua=` |
| apex MX | `mx.transip.email` (normal mailbox provider) | ℹ️ unrelated to sending |

Both **SPF and DKIM align** (relaxed) to the From domain, so auth mail **passes DMARC**
→ inbox placement. `p=none` does not hurt delivery; it just means no enforcement and
no aggregate reports are collected.

## Evidence it actually delivers (not just on-paper)

**Resend send log — 11/11 delivered, 0 bounced, 0 complained** (as of 2026-07-09):

- Recipients included **Gmail** (`…@gmail.com`), **Hotmail** (`pete_carlson@hotmail.com`),
  and business domains (`@teamignition.nl`, `@thisplays.nl`, `@groeniek.nl`) — every
  one `status: delivered`.
- Subjects in use: `PlusOne: You've been invited`, `You've been invited`,
  `Your sign-in link`.

**Supabase auth logs (24h) + auth.users:** 10 users, 7 confirmed, 3 signed in the last
7 days. **Zero SMTP/send-side errors** in the logs — the only mail-related log lines are
user-side friction (`email link has expired`, `One-time token not found`, mistyped TOTP),
never a delivery failure.

## How to re-verify (recipe)

- **Resend MCP / dashboard:** `list-domains` → confirm `theoperators.nl` = verified,
  sending enabled. `list-emails` → confirm recent auth mail `status: delivered`, watch
  for any `bounced`/`complained`.
- **Supabase MCP:** `get_logs(service: "auth")` → scan for SMTP errors (there should be
  none); `auth.users` for confirmed/sign-in counts.
- **DNS:** query a **public** resolver (not the local ISP one, which hijacks lookups):
  `resend._domainkey`, `send.<domain>` TXT+MX, `_dmarc.<domain>`.

## Open / scale-time (NOT blocking launch)

1. **Borrowed domain (F3).** Login mail is `From @theoperators.nl` and the app is on a
   `*.vercel.app` URL. Fine for pilots, but PlusOne's login deliverability is coupled to
   another brand's domain reputation. Permanent fix = dedicated PlusOne sending + app
   domain (branded-mail F3, 86ey6b3hv). Don't let "for now" become permanent silently.
2. **Resend plan / volume limits.** Every login is an OTP send. Confirm the Operators
   Resend plan's daily/monthly caps before onboarding venues at scale (≥5–25). Volume is
   trivial today (11 mails), so no issue yet.
3. **DMARC `p=none`, no `rua=`.** Optional: add `rua=mailto:…@theoperators.nl` to collect
   aggregate reports and get visibility. Consider tightening to `p=quarantine` later,
   only after reports confirm all legit mail aligns.
