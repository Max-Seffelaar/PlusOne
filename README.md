# PLUSONE — Gastenlijstbeheer voor venues

**Zet ze op de lijst. Wij doen de deur.**

Multi-tenant SaaS voor gastenlijstbeheer bij venues (clubs, zalen). Honderden venues, tientallen evenementen per maand, 50–150 gasten per event. Kernwaarden: fraudebestendigheid (alles gelogd), snelheid aan de deur (offline-tolerant), quotabeheer (personeel krijgt beperkte gastenlijstplekken).

## Stack

- **Next.js 15** (App Router, TypeScript strict) + Tailwind CSS + shadcn/ui
- **Supabase** (Postgres, Auth, Realtime)
- **TanStack Query + IndexedDB** (offline-first PWA)
- **Zod, Vitest, Playwright, pgTAP**

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Start local Supabase stack
supabase start

# Run dev server
pnpm dev

# Visit http://localhost:3000
```

### Testing

```bash
# Unit tests
pnpm test

# E2E tests
pnpm e2e

# Database + RLS tests
supabase db reset && pnpm db:test
```

### Database

```bash
# Reset to seed data
supabase db reset

# Generate TypeScript types from schema
pnpm run supabase:gen

# Deploy migrations to prod (after a merge to main — there is no staging DB)
supabase db push --linked
```

## Documentation

- [`gastenlijst-app-spec.md`](gastenlijst-app-spec.md) — Functional & technical spec (source of truth)
- [`design-system.md`](design-system.md) — UI tokens & design rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Architecture overview
- [`bouwplan-claude-code.md`](bouwplan-claude-code.md) — Phase-by-phase build plan
- [`CLAUDE.md`](CLAUDE.md) — Project rules for Claude Code

## Phases

See `bouwplan-claude-code.md` for detailed breakdown:

1. **Fase 0:** Scaffold & infrastructure ✅
2. **Fase 1:** Database schema (migratie 1) ✅
3. **Fase 2:** RLS policies + tests ✅
4. **Fase 3:** Audit triggers ✅
5. **Fase 4:** Auth (OTP, invite-only, MFA) ✅
6. **Fase 5:** Venue & user management ✅
7. **Fase 6:** Events, tiers & list lock ✅
8. **Fase 7:** Guest list, quota engine & request flow ✅
9. **Fase 8:** Landing page & approval flow ✅
10. **Fase 9:** Door app (PWA, offline, sync) ✅
11. **Fase 10:** Audit log view & statistics ✅
12. **Fase 11:** GDPR: anonymization & retention ✅
13. **Fase 12:** Security audit, e2e & launch checklist
14. **Fase 13:** Stripe Billing (optional, after MVP)

> **UI architecture (2026-06-21):** one responsive surface — the `po` app at `/app` (the desktop `(app)` dashboard was retired; old routes redirect to `/app`). See `CLAUDE.md` and spec decision #41.

## Manual Setup (Max)

After `pnpm install`:

1. **Supabase project (prod only — there is no staging DB):**
   - Production: **eu-west-1 (Ireland)**, ref `tolxwgqhppdcvnogdpel`. Local dev/tests run against the **local** Supabase stack.

2. **Link to Supabase (prod):**
   ```bash
   supabase link --project-ref tolxwgqhppdcvnogdpel
   supabase start  # local stack; pop-up login → authorize
   ```

3. **Connect to Vercel:**
   - Import this GitHub repo
   - Add the **plain** env vars (prod values from the Supabase dashboard): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` (not the `_STAGING`/`_PROD`-suffixed names)
   - Set region to `fra1`

4. **Local `.env.local`:**
   - `pnpm dev` auto-writes `.env.local` from the running local stack (`scripts/dev-env.mjs`); it skips when one already exists. Manual refresh: `pnpm dev:env`.

5. **Seed development data:**
   ```bash
   supabase db reset  # Applies migrations + runs seed.sql
   ```

6. **Run tests:**
   ```bash
   pnpm lint && pnpm test && pnpm db:test
   ```

All phases are built incrementally — no rewriting prior work.

---

**Status:** Backend foundation (Fases 0–3) complete on `main`. Fase 7 (quota-engine + quick-add parser + verzoekflow) lands the fraud-critical core via PR #3 — DB + parser fully verified (pgTAP 190, Vitest 40); its server actions + UI await integration with the auth shell.
