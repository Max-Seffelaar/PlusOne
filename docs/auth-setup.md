# Auth setup — Supabase dashboard & env (Fase 4)

The auth layer is **passwordless e-mail OTP, invite-only, MFA-mandatory for
admin/finance** (CLAUDE.md §Auth, spec §5, decisions #20/#24). The code enforces
this, but a few settings live in the Supabase project and **must be set by hand
per environment** (staging + production). Local development mirrors them through
`supabase/config.toml` (already committed) so `supabase start` reproduces the
same behaviour.

> ⚠️ These are project-level settings — they are NOT in migrations. Set them on
> every new Supabase project (staging, production) before going live.

## 1. Email provider & signups (Authentication → Providers → Email)

| Setting | Value | Why |
|---|---|---|
| **Enable Email provider** | **ON** | OTP login runs on the email provider. |
| **Confirm email** | **ON** | First OTP verification confirms the address. |
| **Secure email change** | **ON** | Double opt-in on e-mail change (decision #24) — confirmed from both old and new inbox. |
| **Enable email OTP** (6-digit code) | **ON** | We use the numeric code, not magic links, in a PWA (spec §5). |

### Disable password authentication

Password login must be off (decision #20 — "Password auth is disabled in project
settings"):

- Dashboard: **Authentication → Sign In / Providers → Email → turn OFF "Allow
  password sign-in" / password-based auth** (label varies by dashboard version).
  Keep only OTP enabled.
- We never render a password field, so even if the toggle is unavailable in your
  dashboard version, there is no password surface. Verify no password grant is
  possible with a raw API call before launch (see `docs/launch.md`, Fase 12).

### Disable public signups (invite-only, decision #20)

- **Authentication → Settings (Sign Up) → "Allow new users to sign up" = OFF.**
- Accounts are created exclusively by the invite flow (`inviteUserAction` →
  service-role `admin.createUser`). With signups off, a stolen anon key cannot
  create accounts.
- Local mirror: `config.toml` → `[auth] enable_signup = false`
  (`GOTRUE_DISABLE_SIGNUP=true`). Note: do **not** set `[auth.email].enable_signup`
  — in the CLI that key toggles the whole email provider off.

## 2. Token lifetimes & sessions (Authentication → Sessions / JWT)

| Setting | Value | Notes |
|---|---|---|
| **Access token (JWT) expiry** | **3600s** (1 h) | Short-lived; tune down if desired. |
| **Refresh token rotation** | **ON** | A stolen refresh token is single-use. |
| **Refresh token reuse interval** | **10s** | Grace window for races. |
| **Inactivity / time-box** (optional) | per policy | Consider a session time-box for door devices. |

Local mirror: `[auth] jwt_expiry = 3600`, `enable_refresh_token_rotation = true`,
`refresh_token_reuse_interval = 10`.

## 3. OTP (Authentication → Email → OTP)

| Setting | Value |
|---|---|
| **OTP length** | **6** |
| **OTP expiry** | **600s** (10 min) |

Local mirror: `[auth.email] otp_length = 6`, `otp_expiry = 600`.

### Email template must show the code

The OTP/Magic-Link email template **must include `{{ .Token }}`** so the user
sees the 6-digit code (not only a link). The Supabase default template already
includes both a link and "enter the code: {{ .Token }}" — if you customise it,
keep the token. Template editor: **Authentication → Email Templates → Magic Link**.

## 4. MFA / TOTP (Authentication → Multi-Factor)

| Setting | Value | Why |
|---|---|---|
| **TOTP (Authenticator app) enroll** | **ON** | Enrollment flow (`/mfa/enroll`). |
| **TOTP verify** | **ON** | Step-up + login challenge. |

- MFA is **mandatory for admin & finance** — enforced in-app
  (`requireAppAccess` → `/mfa/enroll`) and in RLS (AAL2 on sensitive writes).
  The dashboard only needs TOTP enabled; the *mandatory* part is our code.
- Local mirror: `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true`.

## 5. Rate limits (Authentication → Rate Limits)

Anti-abuse + anti-enumeration (spec §5). Set conservative limits for **"Email
sent" / OTP requests** (e.g. a handful per hour per address). The UI already
surfaces rate-limit feedback in Dutch (`describeAuthError`). Local uses a lenient
`[auth.email] max_frequency = "5s"` for development; production should be
stricter via the dashboard.

## 6. URLs (Authentication → URL Configuration)

- **Site URL**: the production app URL (e.g. `https://app.plusone.nl`).
- **Redirect URLs** (allow-list): include `…/auth/callback` and `…/auth/confirm`
  for every environment (the confirm route handles the e-mail-change link).
- Local mirror: `[auth] site_url`, `additional_redirect_urls`.

## 7. Environment variables (Vercel, per environment)

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Anon key (RLS-scoped). |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Used solely by `inviteUserAction` (`admin.createUser`). Never expose to the browser — CLAUDE.md. |

Local values live in `.env.local` (gitignored) and come from `supabase status`.

## 8. Quick verification

After setting the above on a fresh project:

1. Public signup blocked: `POST /auth/v1/signup` (anon key) → rejected.
2. OTP for a non-invited address: returns generically, no account created.
3. Invite → first OTP login provisions the membership (see `tests/e2e/invite-accept.spec.ts`).
4. Admin login → forced to `/mfa/enroll`; AAL2-only screens refuse until verified
   (`tests/e2e/mfa-enroll.spec.ts`, `tests/e2e/aal2-denied.spec.ts`).
