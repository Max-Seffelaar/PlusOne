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
| **Refresh token reuse interval** | **10s** (≥10; raise to ~30 if you see sporadic logouts) | Grace window for the browser-vs-server refresh race in SSR — too small and a slightly-stale concurrent refresh trips reuse-detection and **revokes the whole session** (→ full re-login → re-MFA). |
| **Time-box user sessions** | **OFF, or ≥ 30 days** | ⚠️ See "Stay logged in" below. A short time-box forces a full re-login (and, for admin/finance, another MFA) the moment it elapses. |
| **Inactivity timeout** | **OFF / generous** | ⚠️ An inactivity timeout shorter than the gap between visits kills the session → re-login → re-MFA. |

Local mirror: `[auth] jwt_expiry = 3600`, `enable_refresh_token_rotation = true`,
`refresh_token_reuse_interval = 10`.

### Stay logged in — "remember me" (why MFA must NOT re-prompt every visit)

The app persists the session for **30 days** so a returning user is not forced to
log in (and admin/finance re-MFA) constantly. This is intentional and already wired:
the access token stays short-lived, but the **refresh-token cookie** is given a
30-day `maxAge` in all three Supabase clients (`src/lib/supabase/cookie-options.ts`
→ `AUTH_COOKIE_MAX_AGE`, applied in `server.ts`, `client.ts`, `middleware.ts`).
**AAL2 is sticky for the session** (verifying MFA upgrades the session; refreshes
preserve `aal2`), so within the window a returning user keeps their MFA assurance
**without re-challenging** — MFA is once *per device per 30 days*, not per login.

For that to actually hold, the server-side session must outlive the cookie:

- **Do not** set a short **Time-box user sessions** or **Inactivity timeout** —
  either one terminates the session server-side, after which the 30-day cookie is
  useless (`getUser()` fails → middleware bounces to `/login` → fresh login is
  AAL1 → `/mfa/verify`). This is the #1 cause of "I have to MFA again and again".
- Keep the **reuse interval** ≥ 10s (raise if sporadic logouts persist).
- Re-login is then only expected on: a genuinely new device/browser, cleared
  cookies/incognito, switching between the Vercel preview URL and the prod domain
  (cookies are per-domain), an admin remote-logout, or after 30 days.

To change the window, edit `AUTH_COOKIE_MAX_AGE` (one constant) and match the
dashboard **Time-box** to it.

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

### Invite email → must use the SSR `token_hash` route (REQUIRED)

`inviteUserAction` sends a new invitee the **"Invite user"** template via
`inviteUserByEmail`. For the **server-side** session to come up, the link must hit
our own `/auth/confirm` route with a `token_hash` — a raw PKCE `code` link can't be
exchanged from an e-mail click (there is no verifier cookie), so the default
`{{ .ConfirmationURL }}` template will *silently fail to log the invitee in*. Edit
**Authentication → Email Templates → "Invite user"** to:

```html
<h2>You've been invited to PlusOne</h2>
<p>Accept your invite and set up access:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/app">Accept the invite</a></p>
```

- **Site URL** (§6) must be the production app URL — it is the `{{ .SiteURL }}` base.
- `{{ .TokenHash }}` + `type=invite` are verified statelessly by `/auth/confirm`
  (`verifyOtp`), which then runs `accept_pending_invites()` and lands them at `/app`.
- The **"Magic Link"** template (above) already drives the *existing-user* invite
  notification (a user from another venue, #24) — same token_hash / 6-digit code.
- **Local mirror (since T1 PR b):** both templates are committed under
  `supabase/templates/` and wired in `config.toml`
  (`[auth.email.template.invite]` / `[auth.email.template.magic_link]`), so the
  Mailpit e-mails carry the same clickable `/auth/confirm` links as prod should.
  Restart the local stack after changing them.

## 4. MFA / TOTP (Authentication → Multi-Factor)

| Setting | Value | Why |
|---|---|---|
| **TOTP (Authenticator app) enroll** | **ON** | Enrollment flow (`/mfa/enroll`). |
| **TOTP verify** | **ON** | Step-up + login challenge. |

- MFA is **fully optional for every role** (since 2026-07-02, T1 86ey4j1dz;
  was: mandatory enrollment for admin/finance + AAL2 on sensitive actions).
  No RLS AAL2 requirements remain (migration `20260702120000_mfa_fully_optional`).
  Admin/finance get a skippable in-app **recommendation** (`/mfa/enroll` with
  "Ask me in 7 days" / "Don't ask again" → `user_profiles.mfa_snooze_until`);
  any role can self-enable/disable from the profile. The dashboard only needs
  TOTP enroll/verify enabled — everything else is our code.
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
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Used solely by `inviteUserAction` (`admin.inviteUserByEmail`). Never expose to the browser — CLAUDE.md. |
| `NEXT_PUBLIC_APP_URL` | optional (scripts) | App origin used by `scripts/invite-link.mjs` to print a ready `/auth/confirm` login link. |

Local values live in `.env.local` (gitignored) and come from `supabase status`.

## 8. Quick verification

After setting the above on a fresh project:

1. Public signup blocked: `POST /auth/v1/signup` (anon key) → rejected.
2. OTP for a non-invited address: returns generically, no account created.
3. Invite → first OTP login provisions the membership (see `tests/e2e/invite-accept.spec.ts`).
4. Admin login without a factor → skippable `/mfa/enroll` recommendation
   ("Ask me in 7 days" / "Don't ask again"); after snoozing, the app opens at
   AAL1 (`tests/e2e/mfa-enroll.spec.ts`, `tests/e2e/aal2-denied.spec.ts`).
