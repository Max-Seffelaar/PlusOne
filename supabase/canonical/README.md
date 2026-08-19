# Canonical function bodies (K10 drift guard)

Four SECURITY DEFINER functions have been redefined via `create or replace
function` across many migrations, each time with a comment asking the author
to "keep it in LOCKSTEP" with the sibling copy. That convention has already
regressed prod GDPR behaviour twice (a contacts-anonymization sweep silently
reverted, and a `cancelled_at`-gate fix almost didn't carry forward) — a
comment is not enforcement.

This directory is the actual enforcement. Each file here holds the **exact,
byte-for-byte** `create or replace function ...` statement that is currently
canonical — i.e. the one the newest migration actually defines. A guard test,
`tests/unit/canonical-functions.test.ts`, scans every migration in
`supabase/migrations/` (in filename/timestamp order), finds the LAST
`create or replace function public.<name>` for each of the four functions
below, and fails the suite (`pnpm vitest run`, part of the existing `pnpm
test` step) if that body doesn't match the file here.

Covered functions:

- `audit_trigger.sql` — newest source: `20260706100000_influencers_request_links.sql`
- `run_privacy_retention.sql` — newest source: `20260706101000_request_link_attribution.sql`
- `submit_guest_request.sql` — newest source: `20260819110000_landing_contact_required.sql`
- `approve_guest_request.sql` — newest source: `20260707170000_p0_security_hotfixes.sql`

## When you touch one of these functions

1. Write a new migration with `create or replace function ...` as usual
   (never edit an applied migration).
2. Update the matching file in this directory to the new exact body, in the
   SAME PR.
3. Run `pnpm vitest run tests/unit/canonical-functions.test.ts` — it must be
   the only thing that changes green→green. If it goes red, either the
   canonical file or the migration has a typo/drift relative to the other.

If a PR changes the migration but forgets step 2, the guard test fails CI
immediately — that is the whole point: drift is caught at review time, not
after it silently regresses production three migrations later.
