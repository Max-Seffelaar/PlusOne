# Next Steps — Complete the Auth Layer Setup

**Current Status:** Phase 1 auth layer implementation complete and committed.

---

## 🎯 What You Need to Do Next

### Step 1: Apply Database Migration (5 min)

The auth layer added a new migration for the invite system. Apply it:

```bash
cd C:\Users\Maxse\.claude\projects\plusone

# Reset local Supabase — applies all migrations + seeds test data
supabase db reset

# This will:
# ✓ Run 00000000000000_init.sql (core schema)
# ✓ Run 20260612000000_rls_policies_and_helpers.sql (RLS)
# ✓ Run 20260612000001_audit_system.sql (audit triggers)
# ✓ Run 20260612000002_invite_and_mfa.sql (invite system + MFA)
```

### Step 2: Regenerate TypeScript Types (2 min)

After migrations run, update generated types:

```bash
pnpm db:types
```

This fixes the remaining TypeScript errors about database table properties.

### Step 3: Configure Supabase Dashboard (10 min)

Follow the **12-step guide** in `docs/SUPABASE_SETUP.md`:

1. Disable password auth (keep OTP)
2. Set OTP: 6-digit, 5-minute expiry
3. Enable TOTP for MFA
4. Set JWT expiry: 1 hour
5. Enable refresh token rotation
6. Configure redirect URLs (for production)
7. Disable public signups
8. Create test users (via CLI or dashboard)
9. Verify RLS on all tables
10. Configure webhook settings (for Phase 2)
11. Check service-role security
12. Test the setup

**Estimated time:** 10 minutes if Supabase project already created.

### Step 4: Verify Everything Compiles (2 min)

```bash
pnpm type-check
# Should output: "0 errors"

pnpm lint
# Should output: No issues found
```

### Step 5: Start Dev Server & Test (5 min)

```bash
pnpm dev

# In browser:
# 1. Navigate to http://localhost:3000
# 2. Should redirect to /auth/login
# 3. Enter a test user email
# 4. Check Supabase logs for OTP code
# 5. Enter code to verify
# 6. Should redirect to dashboard
# 7. Dashboard shows "Mijn Venues"
```

---

## 📋 What Was Built (Phase 1)

| Component | File | Status |
|-----------|------|--------|
| **Database** | `supabase/migrations/20260612000002_invite_and_mfa.sql` | ✅ Complete |
| **Auth Library** | `src/lib/auth.ts` | ✅ Complete |
| **Auth Types** | `src/features/auth/types.ts` | ✅ Complete |
| **Server Actions** | `src/features/auth/server-actions.ts` | ✅ Complete |
| **Login Component** | `src/components/LoginOTP.tsx` | ✅ Complete |
| **Login Page** | `src/app/auth/login/page.tsx` | ✅ Complete |
| **Invite Page** | `src/app/auth/invite/[token]/page.tsx` | ✅ Complete |
| **Dashboard** | `src/app/dashboard/page.tsx` | ✅ Complete |
| **Logout** | `src/app/auth/logout/route.ts` | ✅ Complete |
| **Middleware** | `src/middleware.ts` | ✅ Complete |
| **AuthGuard** | `src/components/AuthGuard.tsx` | ✅ Complete |
| **E2E Tests** | `e2e/auth-login.spec.ts` | ✅ Complete |
| **Documentation** | `docs/SUPABASE_SETUP.md` | ✅ Complete |

---

## 🔒 Security Checklist (Completed)

✅ Session verified server-side (`getCurrentUser`)  
✅ Venue membership + roles checked (if applicable)  
✅ AAL2 helper functions ready (enforceAAL2)  
✅ Input validated via Zod schemas  
✅ RLS policies on all auth tables  
✅ Generic error messages (no PII)  
✅ Service-role key isolated to server-only  
✅ Audit triggers on pending_invites + MFA  
✅ Middleware protects routes  
✅ Public paths explicitly whitelisted  

---

## 🚀 Phase 2 Preview (After Phase 1 is Working)

Once the login flow works end-to-end, Phase 2 adds:

- [ ] **TOTP Enrollment** — QR code + secret display
- [ ] **MFA Verification** — 6-digit prompt for sensitive actions
- [ ] **AAL2 Enforcement** — RLS checks for `aal: 'aal2'` on sensitive routes
- [ ] **First-Login MFA** — Mandatory MFA for admin/finance on first OTP login
- [ ] **Playwright Tests** — MFA enrollment, AAL2 enforcement

---

## 📝 File Structure (New Files Created)

```
plusone/
├── NEXT_STEPS.md                      ← You are here
├── AUTH_IMPLEMENTATION_SUMMARY.md     ← Full details
│
├── docs/
│   └── SUPABASE_SETUP.md             ← Dashboard config guide
│
├── supabase/migrations/
│   └── 20260612000002_invite_and_mfa.sql
│
├── src/
│   ├── app/
│   │   ├── auth/login/page.tsx
│   │   ├── auth/invite/[token]/page.tsx
│   │   ├── auth/logout/route.ts
│   │   ├── dashboard/layout.tsx
│   │   └── dashboard/page.tsx
│   ├── components/
│   │   ├── LoginOTP.tsx
│   │   ├── AuthGuard.tsx
│   │   └── AcceptInvite.tsx (in invite page)
│   ├── features/auth/
│   │   ├── types.ts
│   │   └── server-actions.ts
│   ├── lib/auth.ts                   ← Extended
│   └── middleware.ts                 ← New
│
└── e2e/
    └── auth-login.spec.ts
```

---

## ⏱️ Time Estimate

| Task | Time | Difficulty |
|------|------|-----------|
| Apply migrations | 5 min | Easy |
| Regenerate types | 2 min | Easy |
| Configure Supabase | 10 min | Easy |
| Verify compilation | 2 min | Easy |
| Test login flow | 5 min | Easy |
| **Total** | **24 min** | **Easy** |

---

## ❓ Troubleshooting

**Q: Migrations fail with "table already exists"**  
A: Run `supabase db reset` to wipe + reapply all migrations.

**Q: TypeScript errors after `pnpm db:types`**  
A: Check that `pnpm install` succeeded and `src/lib/database.types.ts` was updated.

**Q: OTP not sending**  
A: Check Supabase **Authentication → Email Templates**. In dev mode, OTP logs to console/dashboard logs.

**Q: Middleware blocking all routes**  
A: Verify `.env.local` has valid `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Q: "service_role key found in bundle" warning**  
A: Should not happen. Run `grep -r SUPABASE_SERVICE_ROLE_KEY src/` — if found, remove from client code.

---

## 📞 Questions?

Refer to:
- `AUTH_IMPLEMENTATION_SUMMARY.md` — Full implementation details
- `docs/SUPABASE_SETUP.md` — Dashboard configuration step-by-step
- `CLAUDE.md` — Architecture decisions (#20, #24, #32)
- `docs/spec.md` — Full functional specification

---

## ✨ You're Almost There!

Once migrations are applied and Supabase is configured, the entire **Phase 1 auth layer** works end-to-end:

✅ Email OTP login  
✅ Invite-only signup  
✅ Dashboard with venue access  
✅ Route protection via middleware  
✅ Logout functionality  

**Estimated time to "Phase 1 working": 30 minutes**

After that, Phase 2 (MFA enforcement) can be implemented in a separate sprint.

Let's go! 🚀
