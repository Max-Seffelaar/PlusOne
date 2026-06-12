# PLUSONE — Guest List SaaS

Multi-tenant guest list management for venues. Built with Next.js 15, Supabase, and Tailwind.

**Status:** Project scaffold complete. Ready for feature development per `CLAUDE.md` and `docs/spec.md`.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Supabase CLI (for local development)
- Vercel CLI (for deployment)

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment template and add your Supabase credentials
cp .env.example .env.local

# Start development server
pnpm dev

# In another terminal, start Supabase local (once initialized)
supabase start
```

Visit `http://localhost:3000` to see the home page.

## Project Structure

```
├── src/
│   ├── app/              # Next.js App Router
│   ├── components/       # Reusable React components
│   ├── features/         # Feature domains
│   │   ├── guests/
│   │   ├── quotas/
│   │   ├── events/
│   │   ├── auth/
│   │   ├── audit/
│   │   └── billing/
│   ├── hooks/            # Custom React hooks
│   ├── lib/              # Utilities and clients
│   │   ├── supabase/     # Supabase clients (browser, server, service)
│   │   └── utils.ts
│   └── test/             # Test setup and helpers
├── supabase/
│   ├── migrations/       # Database migrations (one per task)
│   ├── tests/            # pgTAP tests for RLS and triggers
│   └── config.toml
├── public/
│   ├── manifest.json     # PWA manifest
│   └── service-worker.ts # Service worker placeholder
├── docs/
│   ├── spec.md          # Functional & technical specification
│   ├── design-system.md # Design tokens and rules
│   └── design/          # Design bundle (download from Claude Design)
├── .github/workflows/    # CI/CD pipelines
├── playwright.config.ts  # E2E testing
├── vitest.config.ts      # Unit testing
└── CLAUDE.md            # Project instructions & non-negotiables
```

## Architecture Highlights

- **RLS-first security:** Every table has Row Level Security; app-layer checks are convenience only.
- **Offline-tolerant:** Door app uses IndexedDB + Supabase Realtime for offline check-in.
- **Soft delete everywhere:** `guests` and related records are never hard-deleted.
- **Audit via triggers:** All mutations logged by Postgres triggers, not application code.
- **UUIDv7 for offline entities:** `guests`, `check_ins`, `refusals` generated client-side.
- **Multi-tenant by design:** Users, venues, and events fully isolated via RLS policies.

## Development Commands

```bash
# Run dev server
pnpm dev

# Lint and format
pnpm lint
pnpm format

# Type checking
pnpm type-check

# Run tests
pnpm test              # Unit tests
pnpm test:ui           # Vitest UI
pnpm e2e               # Playwright e2e
pnpm db:reset          # Reset Supabase local + run migrations

# Generate TypeScript types from Supabase schema
pnpm db:types

# Build for production
pnpm build
pnpm start
```

## Key Files to Read

1. **`CLAUDE.md`** — Non-negotiable architecture decisions, security checklist, conventions.
2. **`docs/spec.md`** — Full functional specification with decision table (#1–#39).
3. **`docs/design-system.md`** — Design tokens, component rules, interaction patterns.
4. **`.env.example`** — Required environment variables.

## Database Setup

Once Supabase project is created:

```bash
# Initialize Supabase locally (one-time)
supabase init

# Link to your project
supabase link --project-id <your-project-id>

# Generate TypeScript types
NEXT_PUBLIC_SUPABASE_PROJECT_ID=<your-project-id> pnpm db:types

# Create and apply migrations
supabase db reset  # Applies all migrations in supabase/migrations/
```

## Deployment

### Vercel

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add SUPABASE_PROJECT_ID
vercel deploy
```

Environment variables are configured in `vercel.json` (see `fra1` region constraint).

### GitHub Actions

CI/CD runs on push and PR:
- Lint and type check
- Unit tests (Vitest)
- Database tests (pgTAP on local Postgres)
- Build verification

## Feature Checklist (MVP)

- [ ] Auth: E-mail OTP + MFA for admin/finance
- [ ] Venues: Multi-tenant setup with memberships
- [ ] Events: Draft → Open → Live → Closed workflow
- [ ] Guests: CRUD with quota enforcement and soft delete
- [ ] Check-in: Door app with offline outbox, Realtime sync
- [ ] Audit log: Trigger-based, lesbaarized in UI
- [ ] Quota system: Per-user limits, event overrides, request flow
- [ ] Landing page: Per-event signup with admin approval
- [ ] Billing: `subscriptions` table + status checks (Stripe integration = phase 2)
- [ ] Stats: Inflow charts, occupancy by tier, per-user contributions

## Design & Branding

PLUSONE uses a minimal, high-contrast palette:

- **Background:** `#0B0B0D` (near-black)
- **Accent:** `#B5A6FF` (lavender)
- **Text:** `#FFFFFF` (white)
- **Display font:** Bricolage Grotesque (600/700/800)
- **Body font:** Hanken Grotesk (400–700)

See `docs/design-system.md` and the Tailwind theme in `tailwind.config.ts`.

## Support

- Issues and tasks tracked in ClickUp (linked from CLAUDE.md decision table)
- Design mockups in `docs/design/` (Claude Design handoff)
- Team comms in Slack

---

**Built with ❤️ by Max Seffelaar**
