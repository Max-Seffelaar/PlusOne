# Supabase Setup Guide — PLUSONE Auth Layer

This guide walks through configuring Supabase for PLUSONE's passwordless, invite-only authentication system.

---

## Prerequisites

- Supabase project created in **eu-central-1 (Frankfurt)** region
- `.env.local` populated with Supabase credentials from project settings
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` set

---

## Step 1: Disable Password Authentication

Password auth is disabled per spec decision #20 (passwordless-only).

1. Go to **Supabase Dashboard** → Your Project → **Authentication** → **Providers**
2. Click **Email**
3. **Uncheck** "Enable Email Provider" if it shows password auth
4. Keep the email provider enabled for OTP only
5. Scroll down and verify:
   - ✅ "Enable Email OTP" is checked
   - ✅ OTP expiry is set to **5 minutes**
   - ✅ OTP length is **6 digits**

---

## Step 2: Configure Session & Token Settings

1. Go to **Authentication** → **Providers** → **Email**
2. Set **OTP Expiry**: 5 minutes (prevents brute-force)
3. Set **OTP Type**: Time-based (6 digits)

4. Go to **Authentication** → **Manage Roles**
   - Verify `authenticated` role exists (default)
   - Create role `admin_override` (for server-side operations if needed)

5. Go to **Authentication** → **Session Management**
   - **JWT Expiry**: 1 hour (short-lived per decision #20)
   - **Refresh Token Rotation**: Enable
   - **Reuse Detection**: Enable (prevents token reuse attacks)

---

## Step 3: Enable Multi-Factor Authentication (MFA)

MFA (TOTP) is mandatory for `admin` and `finance` roles on first login.

1. Go to **Authentication** → **MFA**
   - ✅ Enable **TOTP** (Time-based One-Time Password)
   - Keep default settings

2. Configure MFA enrollment requirement (enforced via app RLS, not Supabase settings)

---

## Step 4: Configure Redirect URLs (for production)

When deploying to Vercel:

1. Go to **Authentication** → **URL Configuration**
2. Add **Redirect URLs**:
   - `http://localhost:3000/auth/login` (local development)
   - `http://localhost:3000/dashboard` (local development)
   - `https://your-vercel-domain.vercel.app/auth/login` (production)
   - `https://your-vercel-domain.vercel.app/dashboard` (production)

3. Add **Site URL**:
   - `http://localhost:3000` (local)
   - `https://your-vercel-domain.vercel.app` (production)

---

## Step 5: Disable Public Signups

Only invite-based signup is allowed (decision #20).

1. Go to **Authentication** → **Providers**
2. Under **Email**, set:
   - ❌ **Disable Public Signups**
   - ✅ **Enable Email OTP**

---

## Step 6: Apply Database Migrations

The auth layer includes a migration for the invite system:

```bash
cd C:\Users\Maxse\.claude\projects\plusone

# Apply migrations to local Supabase
supabase db reset

# This will:
# 1. Apply 00000000000000_init.sql (core schema)
# 2. Apply 20260612000000_rls_policies_and_helpers.sql (RLS + helpers)
# 3. Apply 20260612000001_audit_system.sql (audit triggers)
# 4. Apply 20260612000002_invite_and_mfa.sql (invite + MFA schema)
# 5. Seed test data if exists

# Regenerate TypeScript types after migrations
pnpm db:types
```

---

## Step 7: Create Test Users (via Supabase CLI or Dashboard)

For local testing without the invite flow:

### Option A: Via Supabase CLI

```bash
# Create test user with email
supabase auth admin create-user \
  --email admin1@plusone.test \
  --password AdminPassword123

# Create user with OTP (preferred for testing)
supabase auth admin create-user \
  --email admin1@plusone.test
```

### Option B: Via Supabase Dashboard

1. Go to **Authentication** → **Users**
2. Click **Invite** (top right)
3. Enter email address
4. User receives invitation link with OTP setup

---

## Step 8: Verify Auth Configuration

Run the health check:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{ "status": "ok" }
```

---

## Step 9: Test the Login Flow

1. Start the dev server:
   ```bash
   pnpm dev
   ```

2. Navigate to `http://localhost:3000/auth/login`

3. Enter a test user email

4. Check Supabase logs for OTP sent:
   - Go to **Supabase Dashboard** → **Logs** → **Auth**
   - Look for `"status": "otp_sent"` entries

5. In local Supabase (development), check email logs:
   - Supabase sends emails via mock SMTP in dev
   - Check browser console or Supabase logs for the code

---

## Step 10: RLS Policies Verification

The migrations include RLS policies for:
- ✅ `pending_invites` — readable by admin/user_manager only
- ✅ `users` — readable by self + those in same venues
- ✅ `venue_memberships` — readable by admin of that venue + the user
- ✅ `guests`, `quotas`, `events` — defaults to deny; specific policies added per feature

Verify RLS is enabled on all tables:

```bash
# Check RLS status in Supabase Dashboard
# → SQL Editor
# → Run this query:

SELECT table_name, row_security_level
FROM information_schema.tables
WHERE table_schema = 'public'
AND row_security_level = 'ENABLE';
```

---

## Step 11: Webhook Configuration (for Billing Phase 2)

When implementing Stripe billing (decision #32):

1. Go to **Edge Functions** → **Webhooks**
2. Add Stripe webhook endpoint:
   - URL: `https://your-project.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Secret: Store in Supabase Vault

---

## Step 12: Configure Service Role Security

**⚠️ CRITICAL: Service role key must NEVER appear in frontend bundles.**

Check that:
- ✅ `.env.local` has `SUPABASE_SERVICE_ROLE_KEY` (not in `.env.example`)
- ✅ No references to `SUPABASE_SERVICE_ROLE_KEY` in `src/` (client code)
- ✅ Service role only used in server-side code:
  - Server components
  - API routes with `'use server'`
  - Edge Functions

Run a security check:
```bash
grep -r "SUPABASE_SERVICE_ROLE_KEY" src/ && echo "❌ FOUND IN CLIENT!" || echo "✅ Safe"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| OTP emails not sending | Check **Authentication** → **Email Templates** — verify SMTP is configured (test mode: `localhost:3000`) |
| "Invalid JWT" on login | Verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` matches dashboard API keys |
| RLS blocking all queries | Check **Authentication** → **Row Level Security** — ensure policies are created (run migrations) |
| Invite token not found | Verify migration `20260612000002` ran (`supabase db reset`) |
| MFA QR code not scanning | Clear browser cache; regenerate secret in `/auth/mfa/enroll` |

---

## Next Steps

After Supabase setup:

1. ✅ Start dev server: `pnpm dev`
2. ✅ Test login flow: Navigate to `http://localhost:3000/auth/login`
3. ✅ Create first venue + users via dashboard
4. ✅ Test invite acceptance flow
5. ✅ Run tests: `pnpm e2e`

---

## Documentation Links

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [MFA (TOTP) Setup](https://supabase.com/docs/guides/auth/auth-mfa)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Passwordless Auth](https://supabase.com/docs/guides/auth/passwordless-login)

---

## Related

- `CLAUDE.md` — Architecture decisions (#20, #24, #32)
- `docs/spec.md` — Detailed specification
- `supabase/migrations/` — Database migrations
- `src/features/auth/` — Auth implementation
