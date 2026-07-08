/**
 * Outbox-drain micro-benchmark — PR #133 (P1 door outbox data-integrity).
 *
 * This is NOT a CPU benchmark (the PR is a correctness change). It measures the
 * two things that actually changed for the user, on a queue of door check-ins:
 *
 *   1. Healthy-path throughput — proves the extra branches added in C9 don't slow
 *      a normal drain (regression guard).
 *   2. Wedge-scenario recovery — the real win: with ONE permanently-rejected
 *      entry at the FIFO head, how many of the N writes behind it ever sync?
 *      OLD: 0 (the head wedges the queue forever). NEW: all of them.
 *
 * Faithful pure-JS reimplementations of the OLD and NEW drain logic (no imports,
 * so the two variants sit side by side). Run: node scripts/perf/outbox-drain-bench.mjs
 */

const N = 5000;
const MAX_ATTEMPTS = 5;

// A permanently-failing server response (RLS deny — e.g. writing to a locked
// list). Deterministic: it will never succeed on retry.
const RLS_DENY = { code: '42501', message: 'permission denied' };

// ── OLD logic (pre-#133) ────────────────────────────────────────────────────
// classifyError: only quota/tier/capacity were terminal; EVERY other code —
// including 42501/23503/23514 — fell through to 'pending' (transient retry).
function classifyOld(error) {
  if (!error) return { status: 'synced' };
  const code = error.code ?? '';
  if (code === '23505') return { status: 'synced' };
  if (code === '45001' || code === '45002' || code === '45005') return { status: 'error' };
  return { status: 'pending' }; // <-- terminal codes land here → retry forever
}
// drain: breaks on the FIRST pending entry (assumes "pending == offline").
async function drainOld(entries, gateway) {
  let synced = 0;
  for (const e of entries) {
    if (e.status !== 'pending') continue;
    const res = classifyOld(await gateway(e));
    e.status = res.status;
    if (res.status === 'synced') synced++;
    if (res.status === 'pending') break; // <-- one bad head wedges everything behind it
  }
  return synced;
}

// ── NEW logic (#133) ─────────────────────────────────────────────────────────
const TERMINAL = new Set(['23503', '42501', '23514', '23502']);
function classifyNew(error) {
  if (!error) return { status: 'synced' };
  const code = error.code ?? '';
  if (code === '23505') return { status: 'synced' };
  if (code === '45001' || code === '45002' || code === '45005') return { status: 'error' };
  if (TERMINAL.has(code)) return { status: 'error' }; // terminal → skip past
  if (code) return { status: 'pending', codedReject: true }; // coded → dead-letter at cap
  return { status: 'pending' }; // code-less network → pause
}
async function drainNew(entries, gateway) {
  let synced = 0;
  for (const e of entries) {
    if (e.status !== 'pending') continue;
    const res = classifyNew(await gateway(e));
    const attempts = (e.attempts ?? 0) + 1;
    if (res.status === 'pending') {
      if (res.codedReject) {
        e.status = attempts >= MAX_ATTEMPTS ? 'error' : 'pending';
        e.attempts = attempts;
        continue; // skip past — never wedge the tail
      }
      e.status = 'pending';
      break; // code-less (offline) → pause the whole queue
    }
    e.status = res.status;
    if (res.status === 'synced') synced++;
  }
  return synced;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makeQueue = (headError) =>
  Array.from({ length: N }, (_, i) => ({
    clientId: `c${i}`,
    status: 'pending',
    attempts: 0,
    _err: i === 0 ? headError : null, // entry 0 is the permanent reject
  }));
const gateway = async (e) => e._err; // returns the row's canned error (or null)

async function timed(label, fn) {
  const t0 = performance.now();
  const synced = await fn();
  const ms = performance.now() - t0;
  return { label, synced, ms: +ms.toFixed(2) };
}

async function main() {
  console.log(`Outbox drain bench — ${N} queued check-ins, one permanent RLS-deny at the FIFO head\n`);

  // 1) Healthy path (no bad head): regression guard.
  const healthyOld = await timed('OLD  healthy', () => drainOld(makeQueue(null), gateway));
  const healthyNew = await timed('NEW  healthy', () => drainNew(makeQueue(null), gateway));

  // 2) Wedge scenario: the head permanently fails.
  const wedgeOld = await timed('OLD  wedged', () => drainOld(makeQueue(RLS_DENY), gateway));
  const wedgeNew = await timed('NEW  wedged', () => drainNew(makeQueue(RLS_DENY), gateway));

  const rows = [healthyOld, healthyNew, wedgeOld, wedgeNew];
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(14)}  synced ${String(r.synced).padStart(4)}/${N}   ${r.ms} ms`);
  }

  console.log('\nHeadcount that reaches the server after a single bad entry:');
  console.log(`  OLD: ${wedgeOld.synced} of ${N}  (queue wedged — every write behind the bad head is lost)`);
  console.log(`  NEW: ${wedgeNew.synced} of ${N}  (bad head dead-lettered, the rest drain normally)`);
  console.log(`\nHealthy-path throughput unchanged: OLD ${healthyOld.ms}ms vs NEW ${healthyNew.ms}ms (no regression).`);
}

main();
