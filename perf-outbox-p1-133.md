# Perf record — P1 door outbox data-integrity (PR #133)

**Date:** 2026-07-08 · **Branch merged:** `43086bc` · **Migrations:** none

P1 was a **correctness** batch (C8–C14, C28), not a speed batch. The honest
answer to "did anything get faster?" is: **no CPU hot-path got faster, and none
got slower** — but two user-facing latencies improved a lot, and one failure mode
went from *total data-loss* to *full recovery*. This file is the record.

## 1. Drain throughput — regression guard + wedge recovery

`scripts/perf/outbox-drain-bench.mjs` (pure-JS, faithful reimplementation of the
OLD and NEW drain logic side by side). 5000 queued check-ins, one permanently
rejected entry (RLS `42501`) at the FIFO head.

```
  OLD  healthy    synced 5000/5000   2.61 ms
  NEW  healthy    synced 5000/5000   1.37 ms
  OLD  wedged     synced    0/5000   0.32 ms
  NEW  wedged     synced 4999/5000   1.45 ms
```

- **Healthy path:** unchanged (both ~1–3 ms for 5000 entries; the C9 branches add
  no measurable cost). No regression.
- **Wedge scenario (the real win):** with one permanently-failing entry at the
  head, the OLD drain synced **0 of 5000** — it `break`s on the first `pending`
  and never reaches the writes behind it, so every later check-in is stranded
  offline forever. The NEW drain dead-letters the bad head and syncs the other
  **4999 of 5000**. Reliability, expressed as throughput: **0 → 4999 delivered.**

Re-run any time: `node scripts/perf/outbox-drain-bench.mjs`

## 2. Peer-action propagation latency (C11)

Voids / top-ups / revives are `UPDATE`s. The door realtime channel was bound
`INSERT`-only, so a colleague's void was invisible on your device until the
**60 s safety-sync floor** (`SAFETY_SYNC_MS`, `useDoorSync.ts`). Now the channel
binds `event: '*'` and the provider patches the row in place.

| | before | after |
|---|--------|-------|
| Peer void/top-up/revive visible on another door device | up to **60 s** | **~1 s** (realtime) |

Confirmed in the preview walkthrough (Max: *"Works and is fast"*).

## 3. Recovery of a mid-drain kill (C8)

Not a latency number, but the headline reliability change: a check-in stranded in
`syncing` by a PWA kill used to be **lost forever** (no code path completed it,
the sync badge stuck at ≥1). `store.init` now resets `syncing → pending`
(`resumeStuckEntries`), so it replays. Verified live: injected 3 `syncing`
orphans → reload → outbox drained to **0 stranded**, all 3 server-persisted.

## Test suite

`pnpm vitest run` — **590 passed / 50 files**, ~8.1–8.6 s across two runs (stable).
Door subset: 84 tests, including the new outbox state-machine coverage
(`replay.test.ts`, `types.test.ts`, `gateway.test.ts`). `lint` + `type-check` clean.
