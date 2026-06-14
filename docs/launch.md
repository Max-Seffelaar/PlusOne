# Go-live checklist (Fase 12)

Run through this before pointing any **real** environment (staging or
production) at users. Tick every box — several are security-critical and have no
second chance.

## 🚨 Remove / verify-absent: the local dev fast-login (do this FIRST)

Local development ships a deliberate auth shortcut so you can log in as a
full-rights admin without Inbucket or a phone authenticator
(see [auth-setup.md §9](auth-setup.md)). It is **local-only by construction** —
but before go-live, confirm it never reached a real database:

- [ ] **No dev factor in the real DB.** The dev TOTP secret is
  `PLUSONELOCALADMINDEVSECRET234567`. Against staging/production, this must
  return `0`:
  ```sql
  select count(*) from auth.mfa_factors
  where secret = 'PLUSONELOCALADMINDEVSECRET234567';
  ```
- [ ] **The seed was never applied to a real DB.** `supabase/seed.sql` (fake
  users, comped subscriptions, **and the dev TOTP factor**) runs only on local
  `supabase db reset`. Never run `supabase db reset --linked` against
  staging/production.
- [ ] **The backdoor was never promoted into a migration.** Only
  `supabase/migrations/**` reaches prod via `supabase db push`. The guard test
  [`tests/unit/no-dev-backdoor.test.ts`](../tests/unit/no-dev-backdoor.test.ts)
  fails CI if the dev secret or an `auth.mfa_factors` insert appears in a
  migration or in `src/**` — keep it green.
- [ ] **Optional cleanup** once the shortcut is no longer wanted: delete
  `scripts/dev-code.mjs`, the `dev:code` script in `package.json`, and the
  "LOCAL-ONLY MFA fast-path" block at the bottom of `supabase/seed.sql`.

## Auth hardening (see [auth-setup.md](auth-setup.md))

- [ ] Password sign-in disabled — a raw `POST /auth/v1/token?grant_type=password` is rejected.
- [ ] Public signups OFF (invite-only); a raw `POST /auth/v1/signup` is rejected.
- [ ] OTP + MFA (TOTP) enabled; admin/finance are forced through `/mfa/enroll`, and AAL2-only screens refuse at AAL1.
- [ ] Conservative OTP / "email sent" rate limits set in the dashboard (anti-enumeration).
- [ ] Site URL + redirect allow-list set for this exact environment.
- [ ] `service_role` key is server-side only — never present in any client/browser env var.

## Data & migrations

- [ ] All migrations apply cleanly on a fresh DB (`supabase db reset`).
- [ ] RLS (pgTAP), unit (`pnpm test`), and e2e (`pnpm e2e`) suites are green.
- [ ] `src/lib/database.types.ts` regenerated from the latest schema.
- [ ] Backups / PITR enabled on the production project.
