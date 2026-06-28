/**
 * Door hot-path micro-benchmark — T2 (2b/2c) before/after comparison.
 *
 * Simulates 10 concurrent devices doing check-ins on an event with 1750 guests.
 * Each device raises a "realtime" INSERT event for every check-in it performs,
 * which the other 9 devices must deduplicate on receipt.
 *
 * Run:  node scripts/perf/door-hotpath-bench.mjs
 */

const GUESTS = 1750;
const DEVICES = 10;
const RUNS = 5; // average over N runs

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGuests(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `g-${i}` }));
}

function makeCheckIns(guestIds) {
  return guestIds.map((id, i) => ({ id: `ci-${i}`, guest_id: id }));
}

function bench(label, fn) {
  // warm-up
  for (let i = 0; i < 3; i++) fn();

  const times = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  console.log(`  ${label.padEnd(54)} avg ${avg.toFixed(2).padStart(7)} ms  min ${min.toFixed(2).padStart(7)} ms`);
  return avg;
}

// ── 1. Realtime dedup: O(n) .some() vs O(1) Set ──────────────────────────────
// Each device receives ~1750 RT events (one per check-in on other devices).
// For 10 devices that means 10 × 1750 = 17 500 dedup calls total.

console.log('\n── Realtime dedup (10 devices × 1750 RT events each) ──');

const guests = makeGuests(GUESTS);
const guestIds = guests.map((g) => g.id);

function simulateRealtimeOld() {
  // simulate accumulated check-ins growing as the event progresses
  const checkIns = [];
  for (let d = 0; d < DEVICES; d++) {
    for (let i = 0; i < GUESTS; i++) {
      const row = { id: `ci-${i}`, guest_id: guestIds[i] };
      // OLD: linear scan
      if (!guests.some((g) => g.id === row.guest_id)) continue; // wrong-event guard
      if (checkIns.some((c) => c.id === row.id || c.guest_id === row.guest_id)) continue; // dedup
      checkIns.push(row);
    }
  }
  return checkIns.length;
}

function simulateRealtimeNew() {
  const guestIdSet = new Set(guestIds);
  const checkInIdSet = new Set();
  const checkInGuestIdSet = new Set();
  const checkIns = [];

  for (let d = 0; d < DEVICES; d++) {
    for (let i = 0; i < GUESTS; i++) {
      const row = { id: `ci-${i}`, guest_id: guestIds[i] };
      // NEW: O(1) Set lookups
      if (!guestIdSet.has(row.guest_id)) continue;
      if (checkInIdSet.has(row.id) || checkInGuestIdSet.has(row.guest_id)) continue;
      checkInIdSet.add(row.id);
      checkInGuestIdSet.add(row.guest_id);
      checkIns.push(row);
    }
  }
  return checkIns.length;
}

const oldDedupMs = bench('OLD  .some() linear scan × 17 500 calls', simulateRealtimeOld);
const newDedupMs = bench('NEW  Set O(1)  × 17 500 calls            ', simulateRealtimeNew);
console.log(`  Speedup: ${(oldDedupMs / newDedupMs).toFixed(1)}×`);

// ── 2. guestById: O(n) .find() vs O(1) Map ───────────────────────────────────
// Each mutation calls guestById to get the name for the toast.
// With 10 devices and 1750 mutations total, worst-case O(1750) per lookup.

console.log('\n── guestById (1750 lookups over 1750-guest list) ──');

const domainGuests = Array.from({ length: GUESTS }, (_, i) => ({ id: `g-${i}`, name: `Guest ${i}` }));
// look up 1750 arbitrary guests (last half = worst case for .find)
const lookupIds = Array.from({ length: GUESTS }, (_, i) => `g-${GUESTS - 1 - i}`);

const oldFind = bench('OLD  Array.find() per lookup', () => {
  for (const id of lookupIds) {
    domainGuests.find((g) => g.id === id);
  }
});

const guestMap = new Map(domainGuests.map((g) => [g.id, g]));
const newMap = bench('NEW  Map.get()    per lookup  ', () => {
  for (const id of lookupIds) {
    guestMap.get(id);
  }
});
console.log(`  Speedup: ${(oldFind / newMap).toFixed(0)}×`);

// ── 3. buildDoorView refusal sort: O(n log n) vs O(n) ────────────────────────
// With many refusals the sort + spread was redundant (order already guaranteed).

console.log('\n── Refusal reason resolution (1750 refusals) ──');

const refusals = Array.from({ length: GUESTS }, (_, i) => ({
  guest_id: `g-${i}`,
  reason: `reason-${i}`,
  refused_at: new Date(Date.now() + i * 1000).toISOString(),
}));

const oldSort = bench('OLD  spread + sort + iterate', () => {
  const map = new Map();
  for (const r of [...refusals].sort((a, b) => (a.refused_at < b.refused_at ? -1 : 1))) {
    map.set(r.guest_id, r.reason);
  }
  return map;
});

const newIter = bench('NEW  direct iterate (pre-ordered)             ', () => {
  const map = new Map();
  for (const r of refusals) {
    map.set(r.guest_id, r.reason);
  }
  return map;
});
console.log(`  Speedup: ${(oldSort / newIter).toFixed(1)}×`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Summary ──────────────────────────────────────────────────');
console.log(`  Realtime dedup  ${(oldDedupMs / newDedupMs).toFixed(1)}× faster  (O(n)→O(1) per RT event)`);
console.log(`  guestById       ${(oldFind / newMap).toFixed(0)}× faster  (O(n)→O(1) per mutation)`);
console.log(`  Refusal sort    ${(oldSort / newIter).toFixed(1)}× faster  (O(n log n)→O(n))`);
console.log('');
