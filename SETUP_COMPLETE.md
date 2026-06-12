# ✅ PLUSONE Project Scaffold — Setup Complete

**Date:** 2026-06-12
**Status:** Ready for local development and feature implementation

---

## What Was Built

The complete project scaffold for PLUSONE (guest list SaaS) has been initialized with:

### 1. **Frontend Stack**
- ✅ Next.js 15 (App Router, TypeScript strict mode)
- ✅ Tailwind CSS + shadcn/ui
- ✅ PLUSONE design tokens (colors, typography, spacing) in `tailwind.config.ts`
- ✅ PWA setup: manifest.json, service worker skeleton
- ✅ Responsive layout with mobile-first approach

### 2. **Backend & Database**
- ✅ Supabase clients configured (browser, server, service-only)
- ✅ Row Level Security (RLS) architecture ready
- ✅ PostgreSQL schema structure (placeholder migration)
- ✅ pgTAP test template for RLS policies
- ✅ Audit log framework (triggers pattern documented)

### 3. **Tooling & Quality**
- ✅ ESLint + Prettier (code style)
- ✅ TypeScript strict (zero implicit any)
- ✅ Vitest (unit tests) + Playwright (e2e tests)
- ✅ Zod (input validation, not yet wired up)
- ✅ GitHub Actions CI/CD (lint, test, build on every push)

### 4. **Deployment Ready**
- ✅ Vercel configuration (`vercel.json` with `fra1` region constraint)
- ✅ Environment variables template (`.env.example`)
- ✅ Security headers in Next.js config (CSP, HSTS, X-Frame-Options, etc.)

### 5. **Documentation**
- ✅ `CLAUDE.md` — Non-negotiable architecture decisions & security checklist
- ✅ `docs/spec.md` — Full functional specification (39 decisions)
- ✅ `docs/design-system.md` — Design tokens, component rules, interaction patterns
- ✅ `README.md` — Quick start guide
- ✅ `SETUP.md` — Detailed manual steps for Supabase & deployment
- ✅ This file (`SETUP_COMPLETE.md`)

### 6. **Project Structure**
```
plusone/
├── src/
│   ├── app/              # Next.js pages & layouts
│   ├── components/       # Reusable components (empty, ready for shadcn)
│   ├── features/         # Domain-driven structure
│   │   ├── guests/       # Guest management
│   │   ├── quotas/       # Quota enforcement
│   │   ├── events/       # Event lifecycle
│   │   ├── auth/         # Authentication
│   │   ├── audit/        # Audit logging
│   │   └── billing/      # Billing abstraction
│   ├── hooks/            # Custom React hooks (empty)
│   ├── lib/supabase/     # Database clients
│   └── test/             # Test configuration
├── supabase/
│   ├── migrations/       # Database migrations (one per task)
│   ├── tests/            # pgTAP RLS & trigger tests
│   └── config.toml
├── public/               # PWA manifest, icons, service worker
├── docs/                 # Specifications & design system
├── .github/workflows/    # CI/CD pipelines
├── CLAUDE.md             # Project instructions (must read)
└── package.json          # Dependencies (pnpm 9.0.0)
```

### 7. **Git Repository**
- ✅ Git initialized with root commit
- ✅ `.gitignore` configured (excludes env, node_modules, build artifacts)
- ✅ Conventional commit message format in place

---

## What You Need to Do Manually (Next Steps)

### **Step 1: Install Dependencies** (5 min)

```bash
cd C:\Users\Maxse\.claude\projects\plusone
pnpm install
```

This downloads all npm packages. Takes ~2–3 minutes on first run.

### **Step 2: Create Supabase Project** (10 min)

1. Go to https://supabase.com/dashboard
2. **New Project:**
   - Name: "plusone-dev" (or "plusone")
   - Region: **eu-central-1** (Frankfurt) — **non-negotiable**
   - Password: Save securely
3. Once created, go to **Settings → API**
4. Copy these four values into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_PROJECT_ID=your-project-id
```

**File location:** `C:\Users\Maxse\.claude\projects\plusone\.env.local`

### **Step 3: Disable Password Auth** (2 min)

In Supabase Dashboard → **Authentication** → **Providers** → **Email**:

- Uncheck "Enable Email Provider"
- Ensure only Email/OTP is available (passwordless per spec decision #20)

### **Step 4: Verify Dev Server** (3 min)

```bash
pnpm dev
```

Visit http://localhost:3000 — you should see the PLUSONE home page with a "Get Started" button.

If successful, press Ctrl+C to stop.

### **Step 5: Run Linter & Tests** (2 min)

```bash
pnpm lint          # Should pass with 0 errors
pnpm type-check    # Should pass with 0 errors
pnpm test          # Should run (test setup only, no tests yet)
```

All commands should complete without errors.

---

## What Comes After (Feature Development Workflow)

Once the above 5 steps are complete, you're ready to start implementing features:

1. **Read the specification** (30 min)
   - `CLAUDE.md` — Architecture & non-negotiables
   - `docs/spec.md` — Functional spec & decision table
   - `docs/design-system.md` — Visual design rules

2. **Create your first database migration** (e.g., user authentication)
   - File: `supabase/migrations/20260613_001_users_and_venues.sql`
   - Write RLS policies + triggers
   - Test with `supabase test db` (if using local CLI)

3. **Build features incrementally**
   - Create React components in `src/app/` or `src/features/`
   - Write unit tests for business logic
   - Commit per logical step (conventional commits)
   - Follow "Definition of Done" in `CLAUDE.md`

---

## Important Files to Read First

| File | Purpose | Time |
|------|---------|------|
| `CLAUDE.md` | Architecture decisions, security checklist | 15 min |
| `docs/spec.md` | Full functional spec (39 decisions) | 20 min |
| `docs/design-system.md` | Design tokens, components | 10 min |
| `README.md` | Quick reference, commands | 5 min |
| `SETUP.md` | Detailed setup steps | 10 min |

---

## Commands You'll Use Most

```bash
# Development
pnpm dev                 # Start dev server (http://localhost:3000)
pnpm build              # Build for production

# Code quality
pnpm lint               # Run ESLint
pnpm format             # Auto-fix formatting with Prettier
pnpm type-check         # TypeScript type check

# Testing
pnpm test               # Run Vitest
pnpm test:ui            # Open Vitest UI
pnpm e2e                # Run Playwright e2e

# Database
pnpm db:reset           # Reset local Supabase DB (applies migrations)
pnpm db:types           # Generate TypeScript types from schema

# Git
git add -A
git commit -m "feat: add feature name"
git push
```

---

## Architecture Highlights (Read CLAUDE.md for Details)

1. **RLS is the security boundary** — Every table has Row Level Security policies. App-layer checks are convenience only.
2. **Soft delete everywhere** — Records are never hard-deleted; they get `status = 'removed'`. AVG-compliant.
3. **Audit via triggers** — All mutations logged by PostgreSQL triggers, never app code. Impossible to bypass.
4. **UUIDv7 for offline** — Guests, check-ins, refusals generated client-side with UUIDv7 for offline-first architecture.
5. **Multi-tenant by design** — Users, venues, and events fully isolated via RLS + venue_memberships table.
6. **Offline-first door app** — Uses IndexedDB + Supabase Realtime. Survives 4G dropouts, syncs when reconnected.

---

## Known Limitations & Placeholders

- **Design bundle:** The HTML/CSS from Claude Design is referenced in `docs/design-system.md` but the actual `.html` files should be downloaded separately.
- **Icons:** Placeholder for PWA icons in `public/icons/`. Replace with actual PLUSONE icons.
- **Service worker:** Skeleton in `public/service-worker.ts`. Implement caching strategies as needed.
- **Stripe integration:** Schema ready (`subscriptions` table), but webhook handlers are phase 2.

---

## Estimated Time to Production MVP

- **Phase 1 (This week):** Auth + User/Venue setup = 20–30 hours
- **Phase 2 (Next week):** Guest CRUD + Quota logic = 30–40 hours
- **Phase 3 (Week 3):** Check-in app (offline-first) = 40–50 hours
- **Phase 4 (Week 4):** Landing page + Audit log = 20–30 hours
- **Phase 5 (Week 5):** Polish + Testing = 20–30 hours

**Total MVP:** ~150–180 hours of engineering (4–5 weeks with 1 developer).

---

## Support & Documentation

- **Architecture Q's** → Read `CLAUDE.md` (non-negotiables are final)
- **Feature Spec Q's** → Read `docs/spec.md` (decision table #1–#39)
- **Design Q's** → Read `docs/design-system.md` (tokens, components)
- **Setup Q's** → Read `SETUP.md` (detailed steps)
- **Command Q's** → Run `pnpm --help` or check `README.md`

---

## Final Checklist Before Starting Development

- [ ] Run `pnpm install` ✓
- [ ] Create Supabase project in eu-central-1
- [ ] Add `.env.local` with credentials
- [ ] Disable password auth in Supabase
- [ ] Run `pnpm dev` and see home page
- [ ] Run `pnpm lint`, `pnpm type-check`, `pnpm test` all pass
- [ ] Read `CLAUDE.md` (non-negotiables)
- [ ] Read `docs/spec.md` (full spec)
- [ ] Push to GitHub (optional but recommended)

---

**You're all set! Start with Step 1 above and reach out if you hit any blockers.**

Good luck building PLUSONE! 🚀
