# Before/after: venue-scope read fix (#143 — SCALE-5/K8/FE-3)

A TRUE same-machine A/B of the only merged change that altered read performance:
commit `e93d3dc` (2026-07-09), "fix(scale): venue-scope reads — SCALE-5/K8/FE-3,
stop shipping event-id lists". Both shapes ran against the SAME seeded data in the
SAME run — only the query shape differs. No schema/seed/timing confounds.

**Method:** [`scripts/perf/scale-beforeafter.mjs`](scripts/perf/scale-beforeafter.mjs)
(new, reuses `scale-audit.mjs`'s seed/measure/teardown infra) hand-reproduces the
exact pre-fix query shapes from `git show e93d3dc^:src/features/po/queries.ts`
(the old `.in('event_id', eventIds)` reads, using the same unchanged
`fetchAllRanged` paging helper) and runs them back-to-back against the current
source functions (loaded live via Vite SSR, same as `scale-audit.mjs`), against
two seeded topologies on the local stack:

1. **Fleet** — 1 venue × 400 events × 5 guests (the SCALE-5 URL-length axis).
2. **Mega** — 1 venue, one 25 000-guest event + one 2 500-guest event (the K8
   download-volume axis).

Both runs used the service-role client (bypasses RLS — see caveats below).

## Headline

**The venue-wide reads that used to 414 above ~205 events now complete in a single
short request, and the Home headcount tile no longer downloads every guest row —
it downloads 252 bytes instead of 2.34 MB at 25 000 guests.**

- **Home headcount tile** (`fetchEventHeadcounts`): at 400 events the old shape
  **threw "URI too long" (414)**; the new shape returns in ~8 ms with a 57-char
  URL. At one 25k-guest event, the old shape shipped **2.34 MB across 28
  requests**; the new shape ships **252 bytes in 1 request** — ~9 700× fewer
  bytes, 28× fewer requests.
- **All-Guests tab** (`fetchGuests`, venue-wide): at 400 events the old shape
  414'd; the new shape returns 2 000 rows in 3 ranged requests with a 271-char URL.
- **Requests inbox** (`fetchGuestRequests` + `fetchQuotaRequests`): both 414'd at
  400 events pre-fix; both now complete in 1–2 short requests.
- **Write throughput is unchanged** (this was a read-path-only fix): 1 013
  check-ins/sec across 45 concurrent scanners, matching the previously-recorded
  baseline of 872/sec (the difference is machine variance, not a regression —
  both comfortably clear the door's real-world write rate).

## Fleet dimension — 1 venue × 400 events (SCALE-5/K8/FE-3, the 414 axis)

Every venue-wide read shipped an `.in('event_id', <all 400 ids>)` filter pre-fix.
At ~39 chars/event that's a ~15.8 KB request URL — Kong's default header-buffer
limit is ~8 KB, so **every one of these reads actually threw "URI too long" when
executed against the local stack** (not just a byte-count projection — confirmed
live):

| Read | BEFORE | AFTER | URL delta |
|---|---|---|---|
| `fetchGuests` (All-guests tab) | **THREW** (414, 15 835-char URL) | 117 ms, 3 req, 603 kB, 271-char URL, 2 000 rows | 58.4× shorter |
| `fetchTiers` | **THREW** (414, 15 754-char URL) | 7 ms, 1 req, 61 kB, 187-char URL, 400 rows | 84.2× shorter |
| `fetchEventHeadcounts` (Home tile) | **THREW** (414, 15 761-char URL) | 8 ms, 1 req, 32 kB, 57-char URL, 400 rows | 276.5× shorter |
| `fetchGuestRequests` (Requests inbox) | **THREW** (414, 15 914-char URL) | 21 ms, 1 req, 2 kB, 347-char URL, 5 rows | 45.9× shorter |
| `fetchQuotaRequests` (Requests inbox) | **THREW** (414, 15 775-char URL) | 10 ms, 2 req, 1 kB, 208-char URL, 5 rows | 75.8× shorter |
| `fetchVenueRequestLinks` | **THREW** (414, 15 759-char URL) | 5 ms, 1 req, 59 kB, 192-char URL, 400 rows | 82.1× shorter |

Requests/bytes ratios aren't reported for this dimension — the BEFORE request never
completed, so there's no "before bytes" to divide by. The URL-length collapse (46×
to 277× shorter) is the root-cause metric here: it's what flips the read from
414-and-throw to complete-successfully. At "dozens of events/month" per venue, every
active venue would have crossed the ~205-event 414 threshold within 6–10 months —
this fix landed before any real venue got there.

## Mega dimension — 1 venue, 25k-guest event (K8, the download-volume axis)

Same venue (3 events total, so URL length was never the problem here) — this axis
is about `fetchEventHeadcounts` downloading every on-list guest ROW across every
event and summing client-side, instead of aggregating in the database:

| | BEFORE | AFTER | Delta |
|---|---|---|---|
| `fetchEventHeadcounts` | 391 ms, **28 req**, **2.34 MB**, 3 rows | 26 ms, **1 req**, **252 bytes**, 3 rows | 28.0× fewer requests, ~9 722× fewer bytes |

The old shape paged through all 27 500 on-list guest rows (`event_id, plus_ones,
status` per row) at 1 000 rows/page = 28 requests, then summed in JS. The new
shape calls the `venue_event_headcounts` GROUP BY RPC once and gets 3 aggregate
rows back.

## Write throughput — unchanged (regression check)

This fix touched reads only; write path (door check-in inserts) is untouched code.
Confirmed no regression: 45 concurrent scanners × 60 check-ins each (2 700 total)
on the 25k-guest event:

- **1 013 check-ins/sec** (2.7 s wall), 0 errors, 0 unexpected duplicates.
- p50 32.9 ms / p95 101.6 ms / p99 270.2 ms / max 356.5 ms.
- Previously recorded baseline (S3.5a, before this PR existed): 872/sec — this
  run is *faster*, which is machine-load variance between runs, not a real
  improvement from #143 (the fix didn't touch the write path at all).

## Honest caveats — read these before citing these numbers elsewhere

- **Requests and bytes are code-deterministic** — the number of HTTP round-trips
  and payload size a given query shape produces is a property of the code, not
  the machine. These numbers are directly comparable between BEFORE and AFTER,
  and would reproduce on any machine running the same code against the same
  data shape.
- **Milliseconds are a local floor, not a prod prediction.** This ran over
  loopback (`127.0.0.1`) against a local Postgres/Kong/PostgREST stack, using the
  **service-role client, which bypasses RLS entirely**. Hosted latency includes
  real network RTT plus per-row RLS policy evaluation the service role never
  pays for — expect hosted ms to be higher than shown here, especially for the
  role-scoped (non-service-role) real traffic path.
- **Realtime fan-out and per-subscriber RLS cost at scale are hosted-only**,
  per `scripts/perf/realtime-loadtest-hosted.mjs` — SCALE-4 is still pending and
  this audit says nothing about it.
- **The door at 25k guests is UNCHANGED by this fix** — `fetchDoorSnapshot` still
  ships the full guest list (~13.6 MB at 25k, per the existing mega-event audit
  in `perf-scale-audit-megaevent.md`). SCALE-1/K9 (paginating/streaming the door's
  cold-load payload) have not shipped. Don't read this report as "the door scales
  to 25k" — it doesn't yet; only the venue-wide admin/organizer reads (`Home`,
  `All-Guests`, `Requests`) were in scope for #143.
- **`fetchTiers` at 400 events (61 KB, 400 rows) looks large for a "tiers" read**
  because the fleet seed gives every event its own tier — a real venue reuses far
  fewer tiers across many events, so this number is a seed artifact, not a
  representative payload size.

## Reproducing this

```bash
# from the worktree, local stack only, confirm no other session is mid-test
pnpm db:fresh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<local service role key from .env.local> \
  node scripts/perf/scale-beforeafter.mjs all     # fleet + mega + burst
node scripts/perf/scale-beforeafter.mjs teardown
pnpm db:fresh   # full purge
```

Measurement only — no application code changed as part of this report.
