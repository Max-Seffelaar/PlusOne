# ✅ PLUSONE Project — Ready to Start

**Status:** Project scaffold complete and all dependencies installed. Ready for Supabase setup.

**Date:** June 12, 2026

---

## ✨ What's Working

- ✅ **Dependencies installed** (535 packages via pnpm)
- ✅ **TypeScript strict mode** — zero type errors
- ✅ **Next.js 15 dev server** — starts in 2.1s
- ✅ **Production build** — succeeds with optimized output
- ✅ **Core architecture** — Supabase clients, RLS-ready, PWA base
- ✅ **Testing frameworks** — Vitest, Playwright configured
- ✅ **Documentation** — CLAUDE.md, spec.md, design-system.md all in place

---

## 🚀 Next Steps (In This Order)

### **Step 1: Set Up Supabase** (15 min)

1. Visit https://supabase.com/dashboard
2. Create a new project:
   - Name: `plusone-dev` (or similar)
   - **Region: eu-central-1 (Frankfurt)** — critical for compliance
   - Database password: save securely
3. Go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret key` → `SUPABASE_SERVICE_ROLE_KEY`
   - Project ID (from URL) → `SUPABASE_PROJECT_ID`

### **Step 2: Create `.env.local`** (2 min)

Copy your Supabase credentials into `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_PROJECT_ID=your-project-id
NODE_ENV=development
```

**File location:** `C:\Users\Maxse\.claude\projects\plusone\.env.local`

**Note:** This file is already in `.gitignore` — never commit credentials.

### **Step 3: Disable Password Auth** (2 min)

In Supabase Dashboard:
- **Authentication** → **Providers** → **Email**
- Uncheck "Enable Email Provider"
- Keep Email/OTP only (passwordless per spec decision #20)

### **Step 4: Verify Everything** (5 min)

```bash
cd C:\Users\Maxse\.claude\projects\plusone

# Start dev server (Ctrl+C to stop)
pnpm dev
# Visit http://localhost:3000 — should see PLUSONE home page

# In another terminal, verify commands
pnpm lint           # Should pass
pnpm type-check     # Should pass with zero errors
pnpm build          # Should build successfully
```

---

## 📋 Commit History

```
8b7fe73 fix: resolve dependencies and TypeScript errors
ba8943b fix: remove problematic supabase CLI package versions
4cc3f17 docs: add comprehensive setup and completion guide
d37ad8b chore: scaffold PLUSONE SaaS project
```

---

## 📚 Documentation to Read

Read these **before** starting feature development:

| File | Purpose | Time | Priority |
|------|---------|------|----------|
| `CLAUDE.md` | Architecture, security, non-negotiables | 15 min | **MUST READ** |
| `docs/spec.md` | Full functional spec (#1–#39 decisions) | 20 min | **MUST READ** |
| `docs/design-system.md` | Design tokens, components, interactions | 10 min | **MUST READ** |
| `README.md` | Quick reference & commands | 5 min | Nice to have |
| `SETUP.md` | Detailed setup guide | 10 min | Skim if needed |

---

## 🛠️ Essential Commands

**Development**
```bash
pnpm dev              # Start dev server
pnpm build            # Build for production
pnpm start            # Run production server
```

**Code Quality**
```bash
pnpm lint             # (Currently disabled — choose ESLint config in SETUP.md)
pnpm type-check       # TypeScript check (zero errors required)
pnpm format           # Auto-format with Prettier
```

**Testing**
```bash
pnpm test             # Run Vitest
pnpm e2e              # Run Playwright e2e
```

**Database** (after Supabase setup)
```bash
pnpm db:types         # Generate TS types from schema
pnpm db:reset         # Reset local DB (with CLI installed)
```

---

## 🎯 Project Structure at a Glance

```
plusone/
├── src/
│   ├── app/                # Pages & layouts
│   ├── components/         # Shared React components
│   ├── features/           # Domain-driven code
│   │   ├── guests/         # Guest management
│   │   ├── quotas/         # Quota logic
│   │   ├── events/         # Event lifecycle
│   │   ├── auth/           # Authentication
│   │   ├── audit/          # Audit logging
│   │   └── billing/        # Billing abstraction
│   ├── lib/supabase/       # Database clients (browser, server, service)
│   └── test/               # Test config
├── supabase/
│   ├── migrations/         # DB migrations (one per task)
│   └── tests/              # pgTAP RLS tests
├── public/                 # PWA manifest, icons, service worker
├── docs/                   # Specifications & design
├── CLAUDE.md              # **Read first — non-negotiables**
├── package.json           # Dependencies (already installed)
└── tsconfig.json          # TypeScript config (strict mode)
```

---

## 🔑 Key Architecture Decisions

All in `CLAUDE.md` — read before building. Summary:

1. **RLS is security** — Database enforces access, not app code
2. **Soft delete only** — Records get `status = 'removed'`, never deleted
3. **Audit via triggers** — PostgreSQL triggers log all mutations
4. **Client-generated IDs** — UUIDv7 for offline-first design
5. **Multi-tenant by RLS** — Users, venues, events fully isolated

---

## ⚠️ Important Notes

- **Never commit `.env.local`** — credentials are in `.gitignore`
- **Never commit `.env.example`** without sanitizing — it's a template
- **Always read CLAUDE.md** — it contains non-negotiable decisions
- **Test locally first** — `pnpm build` before pushing to Vercel
- **Database changes** — Create migrations in `supabase/migrations/`, one per task

---

## 🎬 Ready to Start Feature Development?

Once Supabase is set up and `.env.local` is populated:

1. **Read** `CLAUDE.md`, `docs/spec.md`, `docs/design-system.md`
2. **Pick first task** — usually "User authentication" or "Venue setup"
3. **Create migration** in `supabase/migrations/`
4. **Write RLS tests** in `supabase/tests/`
5. **Build React component** in `src/app/` or `src/features/`
6. **Commit** with conventional message: `feat(guests): add guest list CRUD`

---

## ✅ Final Checklist

Before starting, verify:

- [ ] pnpm installed (`pnpm -v` shows version)
- [ ] Dependencies installed (`pnpm install` completed)
- [ ] Supabase project created in eu-central-1
- [ ] `.env.local` populated with credentials
- [ ] Password auth disabled in Supabase
- [ ] `pnpm dev` starts without errors
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` completes successfully
- [ ] You've read `CLAUDE.md` (non-negotiables)
- [ ] You've read `docs/spec.md` (functional spec)

---

## 📞 Quick Troubleshooting

| Issue | Fix |
|-------|-----|
| `pnpm: command not found` | `npm install -g pnpm@9.0.0` |
| `.env.local not found` | Copy `.env.example` → `.env.local` and fill in values |
| Dev server won't start | Check `.env.local` is populated with Supabase credentials |
| Type errors in IDE | Run `pnpm type-check` to see all errors |
| Build fails | Check `pnpm type-check` first — same errors |

For more, see `SETUP.md` → FAQ & Troubleshooting.

---

## 🚀 You're Ready!

**Next action:** Set up Supabase (Step 1 above), then come back to start building features.

Good luck! 🎯
