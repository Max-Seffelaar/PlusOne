# Engineering review & standard — 2026-07-07

> The durable record of the full-app review, the scale audit, the honest grade, and the
> decisions made to take PlusOne from "MVP that shipped fast" to "a codebase a senior
> opens and respects." Living rules are enforced in `CLAUDE.md`; the shareable version is
> the review artifact. This doc is the source of truth for **why** and **what next**.
>
> Companion docs: `perf-scale-audit-megaevent.md` (the 25k/fleet numbers),
> `perf-scale-track-3.5.md` (realtime/cost analysis), `perf-baseline-3.5a.md` (1.5k baseline).

## TL;DR — the grade

**C+ today, a scoped hardening + de-dup pass away from A−.** Strong architecture (RLS boundary,
audit triggers, soft-delete, offline outbox, denormalization) undermined by fast-parallel-PR
debt and **one production-breaking scale bug**. The dangerous part is a single bug *class*
(unbounded `.in(event_ids)`), not systemic rot.

| Dimension | Grade | Why |
|---|---|---|
| Architecture & data model | A− | RLS-as-boundary, audit-via-triggers, soft-delete, offline outbox (UUIDv7, idempotent), abstraction seams, `event_id`/`venue_id` denormalization already shipped |
| Security | C+ | Boundary A-grade & never leaked; app-layer actions do service-role work before authz (C1), anon endpoints under-throttled |
| Correctness & reliability | C | Outbox can silently lose check-ins (C8/C9) + corrupt audit (C10) in the core path |
| **Scale readiness** | **D+** | **HTTP 414 breaks every venue within ~a year** (SCALE-5); realtime unproven; door ships 13.6 MB at 25k |
| Code hygiene / redundancy | C | Dead code, 3–7× duplicated primitives, mock-in-prod, no canonical FE domain model |
| Test coverage | B | 434 vitest + 529 pgTAP + perf harness; missing e2e + live-scale |
| Self-awareness / docs | A− | The team documents its own debts (this doc exists). The strongest signal in the repo. |

## Decision log — this review (2026-07-07)

1. **Review method fixed as standard:** 10 independent finder angles → one independent verifier
   per candidate (3-state) → gap sweep. 42 candidates → **35 confirmed, 5 plausible, 2 refuted**.
   Findings ranked by real-world blast radius, not presence. (Full list: review artifact + ClickUp
   "Review 7/7 —" P0–P6, list `901818739469`.)
2. **Fix order is risk-first:** P0 security → P1 door data-loss → P2 audit/quota → P3 cache →
   P4 input/date → P5 mock-purge/cleanup → P6 perf. Door + security ship before polish.
3. **Scale is a capability decision, not a bug list.** CLAUDE.md assumes 50–150 guests/event; we
   stress-tested **25k guests / 45 scanners** and **400 events/venue**. The write path is
   rock-solid (872 check-ins/sec at 45-way, 0 lost); the **client read paths are not** (SCALE-1..5).
   Supporting mega-events + long-lived venues requires the fixes below — decided worth doing
   because SCALE-5 hits every venue in normal use.
4. **The binding scale constraint is realtime fan-out** (postgres_changes per-subscriber RLS),
   provable only on a hosted throwaway project; the fix is the Broadcast migration (scale-track #3a).
5. **Front-end has no canonical domain model** (audit below). Decided: introduce one, collapse the
   duplicate fetchers, and move copy-pasted primitives into the kit. ~1,200–1,900 LOC out of the
   churniest files.
6. **Guardrails go into CI**, because the workflow that created the debt is still running. See
   CLAUDE.md "Scale & front-end discipline".

## Scale findings (measured, not theorized)

| ID | Sev | Finding | Fix |
|---|---|---|---|
| **SCALE-5** | High | Venue reads throw **HTTP 414 at ~205 events** (`.in(all event ids)` URL > ~8 KB). Every venue, ~6–10 months. Breaks Home/Guests/Requests + writes. | Filter by venue in SQL (`events!inner(venue_id)` / denormalize / aggregate RPC) — send ONE venue_id. Same fix as K8. |
| SCALE-1 | High | Door cold-load **13.6 MB / 32 req** at 25k (×45 devices, cross-region) | Server-side windowing + lighter snapshot shape |
| SCALE-2/3 | High | K9 (re-fetch per check-in) + K8 (2.33 MB/10s) escalate to showstopper at 25k | Reprioritize the existing K8/K9 fixes |
| SCALE-4 | hosted | Realtime = 45× RLS eval per check-in on the mega-event | Hosted load-test → Broadcast (#3a) |

Write path (transfers to prod): **872 check-ins/sec at 45-way concurrency, 0 error/dup/lost**,
scope trigger correct. Ranged reads scale (no truncation at 25k). Indexes present. **Local caveat:**
service-client bypasses RLS + loopback hides latency → local ms is a floor; realtime/RLS-cost are
hosted-only. Live is *worse* on latency (Vercel fra1 ↔ Supabase eu-west-1) and egress (metered),
*better* on wire bytes (gzip), and *identical* on the 414 (protocol limit).

## Front-end architecture — the "too many models" audit

**Verdict:** the owner's intuition is correct in substance, imprecise in framing. It's **not random
new models** — it's a **clean 4-layer pipeline with no canonical core**, so every entity variant
spawns a fresh row-type + view-type + mapper.

Hard numbers (excl. tests): FE ≈ **26,900 LOC**. `adapters.ts` = 1,011 LOC (~28 mappers + ~22 view
interfaces). `queries.ts` = 1,891 LOC (~45 fetchers). `hooks.ts` = 1,036 LOC (~40 hooks).
`events.tsx` 2,090 · `settings.tsx` 1,976.

- **Guest = 8 distinct shapes**, up to 4 mapping hops (DB row → `PoGuestRow` → `Guest` → prop; door
  runs a *parallel* pipeline `GuestRow` → `DoorGuest`). **Event = 7 shapes** (`PoEvent`/`HomeEvent`/
  `BoardEvent`/`PoDoorEvent`/`DoorEventMeta`/`EventEditRow`/`PoEventRow`) — five are near-identical
  projections differing by 4–6 display fields.
- **~10 near-duplicate fetchers:** `fetchPoGuests`/`fetchVenueGuests` (~25 LOC apart, `.eq` vs `.in`),
  `fetchTiers`/`fetchVenueTiers` (byte-identical select), `usePoEvents`/`usePoHomeEvents`/
  `usePoDoorEvent`/`usePoDoorCandidates` (~60 LOC of shared scaffolding), the 3 crew fetchers.
- **Primitives copy-pasted, already drifting:** `press` in **26 files** (some at `0.94`, some `0.985`
  — the "identical" copy has started rotting), `cardPress` in 8, 3 copies of `Seg`, 8 reinvented
  `Chip`s, `tierRole` defined twice, date-formatting 12×, a whole parallel `desktop/kit.tsx`.

**Where the hypothesis is overstated (keep these):** the `Po*Row → Po*` split is deliberate and
good (clean server/client boundary, pure unit-tested mappers); the `DoorGuest` second pipeline is
justified by offline/outbox (#25); the settings mappers map genuinely different tables.

**The target architecture (what "right" is here):**
1. **One canonical domain layer** `src/features/po/domain/` — `Event`/`Guest`/`Tier`/`Contact`/
   `Venue`/`CheckIn` as the superset shape (door-only fields optional). The 7 event / 8 guest shapes
   become `Pick<>`/projection *view-models*, not new interfaces.
2. **One adapter boundary per entity** — exactly one `toGuest`/`toEvent` (DB row → domain);
   `optimisticGuest` = `toGuest(partial)`; `tierRole` lives once; all date formatting → one module.
3. **Base queries + React-Query `select` for shape variants** — one `fetchGuests(client, scope)`,
   one `fetchTiers(scope)`, one `fetchCrew(scope)`; hooks share a base and project per screen.
4. **Primitives in the kit** — export `press`/`cardPress`, add `Seg`/`ConfirmSheet`, promote the
   duplicated `Chip`s, fold `desktop/kit.tsx` into `kit.tsx` behind a `variant` prop.

Prize: **~1,200–1,900 LOC (5–8%)**, concentrated in the highest-churn files, and it stops the
fan-out at the source. ClickUp epic: "Front-end consolidation" (FE-1..6).

## The path to "actual standard" (C+ → A−)

1. **Kill the scale time-bomb** (SCALE-5/K8) — the venue-scoped query in ~4 sites. *The literal
   "few small changes to scale for real."*
2. **Stop losing check-ins** (P1: C8/C9/C10) — one outbox PR.
3. **Harden the security app-layer** (P0: C1 + anon throttle/enumeration + IP salt).
4. **Delete cruft & de-duplicate** (FE epic + mock-in-prod purge) — the half a senior sees first.
5. **Prove realtime hosted, land Broadcast** (#3a) — measured, not guessed.
6. **Close the test gap** — one e2e core flow + a URI-length guard so SCALE-5 can't return.
7. **CI guardrails** — the debt can't re-accumulate (see CLAUDE.md).

Do 1–4 and a senior stops wincing; add 5–7 and the codebase reads as intentional.
