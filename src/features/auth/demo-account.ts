// Store-review demo account (Fase 17 S3, 86ey6bfug): the fixed ids, in a
// module with no `server-only` import so client code can compare against them.
// review-window.ts (server-only) re-exports these and documents them; the seed
// (scripts/seed-demo-venue.mjs) and the DB guards mirror the same literals.
// Comparing an id on the client is UX only — the server actions and the DB
// triggers stay the boundary.

/** The demo account's fixed auth user id. */
export const DEMO_USER_ID = 'de300000-0000-7000-8000-00000000a001';

/** The only venue the demo user may be a member of, by id. */
export const DEMO_VENUE_ID = 'de300000-0000-7000-8000-000000000001';
