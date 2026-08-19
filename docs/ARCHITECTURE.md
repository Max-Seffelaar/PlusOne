# Architecture — PLUSONE Guestlist SaaS

## Overview

PLUSONE is a multi-tenant guest list management system for venues (clubs, event spaces). Built with Next.js 15, Supabase, and TanStack Query.

## Core Principles

1. **RLS is the security boundary** — all access control happens in the database
2. **Fraud resistance** — everything is audited via Postgres triggers
3. **Door speed** — offline-first PWA with local-first search and filtering
4. **Quota enforcement** — staff get limited guest list slots per event

## Tech Stack

- **Frontend:** Next.js 15 (App Router, TypeScript strict), Tailwind CSS, shadcn/ui
- **Backend:** Supabase (Postgres, Auth, Realtime, Edge Functions)
- **Offline:** TanStack Query + IndexedDB with outbox pattern
- **Testing:** Vitest (unit), Playwright (e2e), pgTAP (RLS/triggers)
- **Hosting:** Vercel (fra1), Supabase (eu-central-1, Frankfurt)

## Directory Structure

```
src/
  app/              — Next.js routes + layouts
  components/       — UI components
  lib/
    supabase/       — clients (browser, server, service)
  features/         — domain-specific logic
    guests/
    quotas/
    events/
    auth/
    audit/
    billing/

supabase/
  migrations/       — SQL migrations (one per phase)
  tests/            — pgTAP test files
  seed.sql          — local development seed data

tests/
  e2e/              — Playwright end-to-end tests

docs/
  spec.md           — functional & technical spec (source of truth)
  design-system.md  — UI tokens & design rules
```

## Development Workflow

1. Clone repo → `pnpm install`
2. `supabase start` → local Postgres + Supabase stack
3. `pnpm dev` → Next.js dev server at `http://localhost:3000`
4. `pnpm test` → unit tests
5. `pnpm e2e` → Playwright e2e tests
6. `supabase db reset && pnpm db:test` → run database + RLS tests (`pnpm db:test` = `supabase test db` + the plan/run gate)

## Phases (Phases 1–12 for MVP)

See `bouwplan-claude-code.md` for detailed phase breakdown. Each phase = one migration + tests + working staging deploy.

## Security

- Passwordless auth (email OTP) via Supabase Auth
- MFA (TOTP) mandatory for admin/finance
- Soft delete only (no hard DELETE)
- Audit log via Postgres triggers (append-only)
- Service-role key never in client code
- All mutations through Server Actions or Route Handlers

## Next Steps

1. Initialize Supabase project (staging & production)
2. Connect Vercel
3. Start Fase 1: Database schema
