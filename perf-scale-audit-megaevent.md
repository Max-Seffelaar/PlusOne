# Scale audit — mega-event dimension (25 000 guests · 45 scanners)

> Run 2026-07-07 against the local Supabase stack via `scripts/perf/scale-audit.mjs`
> (seeds throwaway 25k + 2.5k events on Club Vesper, calls the REAL source functions
> via Vite SSR, meters global `fetch` for requests + bytes). Extends
> `perf-baseline-3.5a.md` (1500-guest stress) and `perf-scale-track-3.5.md` (many-orgs).
>
> **Why this run:** target topology = 50 venues, 35 events @ 2500 guests × ~10 scanners,
> **1 event @ 25 000 guests × 45 scanners**. CLAUDE.md's core assumption is "50–150
> guests per event" — a 25k event is **150–500× that**, an axis the app was never
> stress-tested on. The many-orgs axis (50 vs the doc's 500) is *smaller*, so the new
> risk is entirely the **single mega-event**.

## Honest scope — local vs hosted

- **Requests + bytes are portable** (same on any host) → trustworthy.
- **Latency (ms) is a floor, not a prediction** — local loopback + the service client
  (which **bypasses RLS**, so it excludes the per-row RLS CPU that dominates on a real
  tier). Do not quote local ms as prod.
- **Realtime fan-out is HOSTED-ONLY** — `postgres_changes` evaluates the `check_ins`
  SELECT RLS *per subscriber per change*. Local can't measure it; use
  `scripts/perf/realtime-loadtest-hosted.mjs` against a throwaway hosted project.

## Measured — reads (metered on real source functions)

| Path | @2.5k | @25k | scales | metric that matters |
|---|---|---|---|---|
| `fetchDoorSnapshot` (door cold-load) | 1.36 MB / 9 req | **13.61 MB / 32 req** | linear ×10 | payload + round-trips |
| `fetchPoGuests` (guests-tab / lijst) | — | 6.29 MB / 26 req | linear | payload |
| `fetchEventHeadcounts` (K8, per venue) | — | **2.33 MB / 28 req** | linear | **× every 10 s from Home** |

Local ms (floor only): door snapshot 1135 ms @25k / 54 ms @2.5k; poGuests 435 ms;
headcounts 280 ms.

## Measured — writes (45 concurrent scanners on the 25k event)

| Metric | Result |
|---|---|
| Check-ins | 2 700 across 45 scanners — **0 dup, 0 error, 0 lost** |
| Throughput | **872 check-ins/sec** (3.1 s wall) |
| Latency p50 / p95 / p99 | 38 / 124 / 340 ms (local floor) |
| Scope trigger | ✅ `set_checkin_scope` filled `event_id` on all 2 700 |

## What HELD UP (good news)

1. **Ranged reads scale** — the door snapshot returns all 25 000 guests, no 1000-row
   truncation. The 3.5b `#0a` fix holds at 25k.
2. **Write path is rock-solid at 45-way concurrency** — 872/sec, zero errors/lost/dups,
   scope trigger correct. Real-world 45 scanners tap ≈ 45–90/sec, far under this. The DB
   write side is **not** the bottleneck even at 10–25× design size.
3. **Headcount math correct at 25k** (35 000 koppen = 25 000 + 5 000×2).
4. **Hot-path indexes all present** — `guests(event_id,status)`, `check_ins(event_id)`,
   `refusals(event_id)`, `guests(tier_id)`.

## ⚠️ SCALE-5 [HIGH — every venue, ~6–10 months] — venue reads 414 at ~205 events

The **highest-impact finding of the whole exercise**, and it has nothing to do with big
events — it's the **events-per-venue** axis. `fetchEvents` has **no date bound**, and the
venue-wide reads pass **every event id** into a PostgREST `.in('event_id', […])` filter.
The URL grows ~39 chars/event and crosses the server's ~8 KB URI limit at **~205 events**:

| Events on venue | ~URL length | Result |
|---|---|---|
| 100 | 3.7 KB | OK |
| 200 | 7.4 KB | OK |
| **210** | **7.8 KB** | **HTTP 414 URI Too Long → the read THROWS** |
| 400 | 15.8 KB | 414 |

At "dozens of events/month" (CLAUDE.md), a venue hits ~205 events in **≈6–10 months** — so
within its first year **every active venue** starts throwing 414 on:
- **Home headcount tile** (`fetchEventHeadcounts`, K8)
- **All-Guests tab** — the default Guests view (`useVenueGuests`/`fetchVenueGuests`)
- **Requests inbox + badge** (`usePoGuestRequests`, `usePoQuotaRequests`, `usePoVenueLinks`)

This is a **hard failure, not a slowdown**, and it hit the audit's own teardown (a 500-id
`.in()` update silently 414'd — proof it breaks writes too, any `.in()` with a few hundred
ids). **Root cause = the same pattern as K8** (send N event ids instead of 1 venue id), so
K8's proper fix resolves it — but this reframes K8 from "low-priority perf, folds into
scale-track" to **"correctness time-bomb, every venue, within a year."**

**Fix:** filter by venue *in SQL* — `events!inner(venue_id)` embed filter, or denormalize
`venue_id` onto `guests`, or an aggregate RPC — so the query sends ONE `venue_id`, never a
list of event ids. (This is the altitude-correct fix the review's efficiency angle already
recommended for K8 / useVenueGuests.)

> **STATUS UPDATE (2026-07-09): FIXED.** Migration
> `20260708120000_venue_scope_denormalization.sql` denormalized `venue_id` onto
> `guests`/`guest_requests`/`quota_requests`/`guest_tiers` (same shape as the
> `check_ins`/`refusals` precedent) + a `venue_event_headcounts` GROUP BY RPC
> (SECURITY INVOKER, so headcounts stay role-relative — not a bypass). `fetchEvents`
> itself is still unbounded by date; that's a separate, smaller follow-up if it ever
> matters (events are already ordered/paginated in the UI). Regression guard:
> `scripts/perf/scale-audit.mjs fleet` — proves 400 events no longer 414s any
> venue-wide read.

## NEW findings (mega-event escalations)

### SCALE-1 [High] — Door cold-load is 13.6 MB / 32 sequential requests at 25k
The snapshot is *correct* but the **payload is the wall**: ~0.55 kB/guest × 25k, over 32
ranged round-trips (latency-bound on real networks; the 3.5a baseline already clocked the
deur cold-load at 14.3 s mobile @1500 — this is ×10 the bytes). × 45 devices cold-loading
at doors-open = a venue-wifi meltdown.
**Fix direction:** server-side windowing at the door (load a working set + search
server-side via an RPC), and/or a lighter snapshot shape (drop columns the door never
renders). This is the real "does the door survive a mega-event" question.

### SCALE-2 [High] — K9 (per-check-in snapshot re-fetch) goes from medium → showstopper
The review rated **K9 medium** at 1500 guests (~1–2 MB re-fetched per check-in). At 25k it
re-downloads **13.6 MB after every check-in**, × 45 devices — and the door persists the
**whole** cache to IndexedDB on the main thread on each mutation (K9 + C14), i.e. serializing
13.6 MB per check-in = a frozen door. **K9's severity is scale-dependent; escalate it for
large events.** The fix (skip the snapshot invalidate on a clean drain — rely on the
optimistic patch + realtime + 60 s safety sync) becomes mandatory, not nice-to-have.

### SCALE-3 [High] — K8 (headcount fan-out) = 2.33 MB / 28 req every 10 s, per Home viewer
At 25k, `fetchEventHeadcounts` pulls **2.33 MB across 28 requests every 10 seconds** per
person with Home open on that venue (≈ 14 MB/min, ≈ 840 MB/hour) — just to render a
headcount tile. The aggregate-RPC fix (K8) is **mandatory before any large event**, not a
scale-track nicety.

### SCALE-4 [hosted-only] — Realtime fan-out on the mega-event = 45× per check-in
45 subscribers on one event × up to 872 check-ins/sec ⇒ ~**39 000 RLS evaluations/sec on a
single event** (`postgres_changes` runs the `check_ins` SELECT policy per subscriber per
change). This is the binding constraint and exactly what the scale-track's
**Broadcast migration (#3a)** removes (authorize once at channel join). **Must be measured
hosted** — see below.

## Architectural note (product decision, not just a bug)

CLAUDE.md assumes 50–150 guests/event. A 25k event is 150–500× that. Several client patterns
that are fine at 150 break at 25k: *download-all-then-aggregate* (K8), *full-snapshot-in-
memory + persist-whole-cache* (K9/door), *sequential ranged paging* (32 round-trips). So
supporting mega-events is a **capability decision**: either (a) cap/shard event size, or
(b) invest in server-side windowing + aggregate RPCs + Broadcast. If mega-events are a real
target, SCALE-1/2/3 + the Broadcast migration are prerequisites, not polish.

## Hosted test — the before/after that local can't give

Use the existing harness against a **throwaway hosted project** (never prod — it refuses the
prod ref + localhost). It authenticates every subscriber as a real doorhost so the Realtime
server runs the RLS per delivery — the true cost.

```sh
# Scenario A — 35 events @ 2500, ~10 scanners each (350 concurrent authed websockets)
LOADTEST_ALLOW=1 LOADTEST_SUPABASE_URL=https://<throwaway>.supabase.co \
LOADTEST_SUPABASE_ANON_KEY=… LOADTEST_SUPABASE_SERVICE_KEY=… \
MODE=postgres_changes EVENTS=35 SUBS_PER_EVENT=10 BURST_PER_EVENT=500 \
  node scripts/perf/realtime-loadtest-hosted.mjs

# Scenario B — 1 mega-event, 45 scanners (worst-case single-event fan-out)
… EVENTS=1 SUBS_PER_EVENT=45 BURST_PER_EVENT=2000 node scripts/perf/realtime-loadtest-hosted.mjs
```

Read delivery-%, lag p50/p95, and the hosted dashboard's **Database CPU% + Realtime
concurrent connections** for the burst window. Then land the Broadcast migration and re-run
`MODE=broadcast` for the after-figure. This is the DoD before onboarding mega-events.

## Reproduce / teardown

```sh
node --env-file=.env.local scripts/perf/scale-audit.mjs all       # seed+measure+burst
node --env-file=.env.local scripts/perf/scale-audit.mjs fleet     # events-per-venue regression guard
node --env-file=.env.local scripts/perf/scale-audit.mjs teardown  # soft-remove (then pnpm db:fresh)
```
Hard DELETE is revoked even for service_role (error 42501 — soft-delete-only #3 verified),
so teardown soft-removes and the empty `__scale__` event shells persist until `pnpm db:fresh`.
