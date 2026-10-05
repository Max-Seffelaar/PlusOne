# Mail deliverability — login OTP (Prod-ready 9/7 — task 10; sender moved in F3, 86ey6b3hv)

**Why this matters:** login is 100% e-mail (OTP code + invite/magic links, decision #20).
If auth mail lands in spam or bounces, **login is down**. This doc records what sends
prod mail today, how the sending domain is authenticated, how to diagnose a failure, and
the rules that keep it working. State verified 2026-10-05.

## Verdict: 🟢 green

Prod auth mail is sent through **Resend** (SMTP) as **`PlusOne <noreply@plus-one.io>`**.
The domain `plus-one.io` is verified in Resend with SPF/DKIM/DMARC in place. Gmail shows
*mailed-by* `rsend.plus-one.io`, *signed-by* `plus-one.io`, delivered to **Inbox**.

## What sends prod mail

- **Provider:** Resend, wired as Supabase Auth's **custom SMTP** (not the built-in
  shared Supabase mailer). Supabase only generates the OTP/invite/magic-link mails;
  Resend transports them via Amazon SES **eu-west-1**.
- **Supabase Auth SMTP settings:** host `smtp.resend.com`, port `465`, sender name
  `PlusOne`, sender address `noreply@plus-one.io`.
- **Sender domain:** the **apex `plus-one.io`**, no subdomain. This is a decision: the
  sender is and stays the apex. Resend domain status **verified**, region **eu-west-1**.
- **Retired:** the old sender `info@theoperators.nl` (a borrowed Operators domain) is
  gone and its Resend DNS records at `theoperators.nl` were removed. Don't reintroduce it.
- **App origin:** `https://app.plus-one.io` (Vercel project `plus-one`).
- **Data residency:** everything stays in the EU — Supabase (Ireland), Resend/SES
  (eu-west-1), Sentry (EU), Vercel (fra1).

## Supabase URL configuration (Auth → URL Configuration)

- **Site URL = `https://app.plus-one.io` — NO trailing slash.** The auth mail templates
  append paths to the Site URL; a trailing slash produced broken `//auth/confirm` links.
- **Redirect allow list:** `https://app.plus-one.io` and `https://app.plus-one.io/**`.

## DNS authentication (DNS hosted at TransIP)

| Record | Value | Purpose |
|---|---|---|
| DKIM `resend._domainkey.plus-one.io` | TXT, key supplied by Resend | signs the mail |
| Return-path `rsend.plus-one.io` (Gmail "mailed-by") | CNAME → `rsend-euw1.forge.rmta.net` (Resend-managed); resolves to MX `10 feedback-smtp.eu-west-1.amazonses.com` + TXT `v=spf1 include:amazonses.com ~all` | bounce handling / SPF alignment for the envelope sender |
| `send.plus-one.io` | CNAME → `send.forge.rmta.net` (Resend-managed); resolves to MX `10 feedback.forge.rmta.net` + SPF with Resend ip4 ranges | Resend's second bounce/return-path host |
| DMARC `_dmarc.plus-one.io` | `v=DMARC1; p=none;` | monitor-only, no `rua=` |
| Apex SPF `plus-one.io` | `v=spf1 include:_spf.google.com ~all` | Google Workspace mailboxes |

The `rsend.` and `send.` records are **CNAMEs to Resend-managed hosts** (verified via
dns.google, 2026-10-05): Resend owns the values behind them, so never hand-edit them. The
DKIM record is a plain TXT; re-copy it from the Resend dashboard if it has to be recreated.

**Exactly one SPF record on the apex.** Two `v=spf1` TXT records make SPF invalid
(permerror) for the whole domain. **Open item:** a stray duplicate `v=spf1 ~all` was found
on the apex on 2026-10-05 and **must be deleted at TransIP** (still live at time of
writing; Max confirms removal). If mail ever fails SPF, count the apex `v=spf1` records
first. Resend's SPF lives on the `rsend.`/`send.` hosts, not the apex — don't merge it into
the apex record.

DKIM and the return-path domain both align (relaxed) to the From domain, so auth mail
passes DMARC. `p=none` does not hurt delivery; it just means no enforcement and no
aggregate reports.

## Troubleshooting

### Every OTP request returns 500 — `550 The plus-one.io domain is not verified`

Seen 2026-10-05. Cause: the sender domain is **not verified in the Resend account that
owns the API key stored in Supabase SMTP** (wrong account/team, or the domain was
verified in a different Resend account). Supabase can't send, so every `/otp` call fails.

Diagnose: Supabase dashboard → **Logs → Auth**, filter on `/otp` with status `500`. The
log line contains `550 The plus-one.io domain is not verified`. Fix: in Resend, open the
account the Supabase API key belongs to → Domains → confirm `plus-one.io` is **Verified**
(re-run verification after fixing DNS), or replace the key in Supabase with one from the
account that has the verified domain.

### Mail arrives in spam / SPF fails

Check the apex has exactly one SPF record (above), DKIM `resend._domainkey` resolves, and
Resend shows the domain as Verified.

## Secret handling

**The Resend SMTP API key lives in exactly two places: Supabase Auth SMTP settings and
the password manager.** Never put it in the repo, `.env*` files, Vercel env vars, ClickUp,
chat or screenshots. The app never sends auth mail itself, so it has no use for it. If it
leaks, rotate it in Resend and paste the new one into Supabase.

## How to re-verify (recipe)

- **Resend dashboard:** Domains → `plus-one.io` verified, region eu-west-1; Emails → recent
  auth mail `delivered`, watch for `bounced`/`complained`.
- **Supabase:** Logs → Auth → scan for SMTP errors (there should be none).
- **Gmail:** open a received mail → Show original → SPF/DKIM/DMARC all `PASS`.
- **DNS:** query a **public** resolver (not the local ISP one, which hijacks lookups):
  `resend._domainkey.plus-one.io`, `rsend.plus-one.io` and `send.plus-one.io` (CNAME/TXT/MX), `_dmarc.plus-one.io`, and the
  apex TXT (one `v=spf1`).

## Open / scale-time (NOT blocking launch)

1. **Resend plan / volume limits.** Every login is an OTP send. Confirm the Resend plan's
   daily/monthly caps before onboarding venues at scale (≥5–25).
2. **DMARC `p=none`, no `rua=`.** Optional: add `rua=mailto:…@plus-one.io` to collect
   aggregate reports. Consider tightening to `p=quarantine` later, only after reports
   confirm all legit mail (incl. Google Workspace) aligns.
