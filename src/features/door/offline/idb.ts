/**
 * Tiny promise-based IndexedDB key/value store (no dependency). Backs both the
 * TanStack Query cache persister and the offline outbox, so the door survives a
 * reload while offline (spec §4: full list local, mutations queued).
 *
 * One database, one "kv" object store, namespaced string keys. SSR-safe: every
 * call no-ops to a resolved empty value when there is no `indexedDB` (server /
 * older webview without the API), so importing this never throws.
 */

import { captureMessage } from '@/lib/observability/sentry-client';

const DB_NAME = 'plusone-door';
const STORE = 'kv';
const VERSION = 1;

/**
 * How long an `indexedDB.open` may stay `blocked` before we give up on it.
 *
 * `blocked` fires only when a VERSION bump needs to run while another connection
 * still holds the old version. Our own tabs release on `versionchange` (see
 * `onsuccess`), but `close()` waits for that tab's in-flight transactions — so a
 * merely BUSY sibling blocks for a few frames and then clears. A FROZEN one
 * (backgrounded webview, hung renderer) never clears, and an open request has no
 * timeout of its own: `dbPromise` would stay pending forever, `restoreClient`
 * would never settle, and the door would sit on the restore gate with nothing
 * logged anywhere. Latent until VERSION is bumped — i.e. it bites on a deploy.
 *
 * BOTH numbers below are ACCEPTED GUESSES, not measurements — we have no low-end
 * Android webview in the loop to measure against. They are split because the two
 * call sites have opposite cost asymmetries, which is the part we can reason about
 * without a device:
 *
 * - WRITES (and non-boot reads) pay 2 s. Failing is cheap: the entry is already in
 *   memory, the UI already rendered, every persist path is fire-and-forget (`void
 *   idbSet` in persister.ts, `void this.persistMerged` in outbox/store.ts), so
 *   nothing the doorhost looks at is waiting on it — the only cost is that the
 *   `persistDegraded` toast arrives later. A wrong guess here is nearly free.
 * - The BOOT RESTORE pays 8 s. Failing costs the entire cached guest list, and at
 *   the door offline is the normal case (CLAUDE.md), so there is no refetch to fall
 *   back on. The only cost of waiting is boot spinner. This is the case the 2 s was
 *   too tight for: a low-end webview under background throttling, where a HEALTHY
 *   sibling's `close()` sits behind an in-flight transaction — slow, not frozen —
 *   would have cost the door its cache. 8 s is chosen to clear the seconds-scale
 *   deferrals that background throttling produces, and capped there so a doorhost
 *   is not left staring at a spinner when it really is the frozen case.
 *
 * If either ever needs to be defended with numbers, measure `close()`-to-release on
 * a throttled webview and replace the guess; do not silently re-tune.
 */
export const IDB_OPEN_BLOCKED_GRACE_MS = 2000;

/** Grace for the boot cache restore — see above for why it is longer than writes. */
export const IDB_OPEN_BLOCKED_RESTORE_GRACE_MS = 8000;

/**
 * After a give-up, how long every `openDb` fails fast instead of re-attempting.
 *
 * Without this, clearing `dbPromise` (which is right for recovery) means the very
 * next caller pays another full grace period, and the callers are not occasional:
 * persister.ts writes on a 2 s trailing throttle, `outbox.commit()` fires on every
 * enqueue, `useDoorSync` runs every 60 s. A persistently frozen sibling would settle
 * into open -> grace -> give up -> Sentry -> repeat every few seconds, for as long as
 * it stays frozen. The blocking tab is not going to disappear within one grace period
 * of the last attempt, so bounding the retries costs recovery latency we do not care
 * about and saves both the repeated blocked opens and the repeated telemetry.
 *
 * This also latches the Sentry message the same way `setPersistDegraded` does in
 * outbox/store.ts (`if (v === this.persistDegraded) return;`): one report per
 * degradation window rather than one per failure. Time-boxed on purpose — unlike a
 * persistent tombstone it can never leave IndexedDB switched off for whoever uses
 * the device next.
 */
export const IDB_OPEN_BLOCKED_COOLDOWN_MS = 30_000;

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;
/** The live connection behind `dbPromise`, tracked so `idbClearAll` can close it
 *  before deleting the database (an open connection would otherwise defer the
 *  delete via `onblocked` until the page navigates away). */
let dbConn: IDBDatabase | null = null;

/**
 * Wipe epoch, bumped by every `idbClearAll` (sign-out). A writer captures it when
 * it SCHEDULES a write (arms a throttle timer, starts a read-merge) and re-checks
 * before committing: if the epoch moved, a wipe happened in between and the write
 * would resurrect the just-deleted door data (queued guest PII) under the next
 * user — so it's dropped. The next user's own writes carry the new epoch and work
 * normally, so this needs no reset (unlike a persistent tombstone that would
 * disable IndexedDB for whoever logs in next on the same JS context).
 */
let epoch = 0;
export function idbEpoch(): number {
  return epoch;
}

/** Set while an attempt is in flight, so a later caller that needs a longer grace
 *  than the one currently armed can raise it (see `openDb`). */
let raiseBlockedGrace: ((ms: number) => void) | null = null;

/** True for `IDB_OPEN_BLOCKED_COOLDOWN_MS` after a blocked open was given up on. */
let openBlockedCooldown = false;

function openDb(graceMs = IDB_OPEN_BLOCKED_GRACE_MS): Promise<IDBDatabase> {
  if (openBlockedCooldown) {
    // We gave up on a blocked open moments ago and the sibling holding the old
    // version has not gone anywhere. Fail fast rather than let every caller pay
    // its own grace period (and emit its own Sentry event) in the meantime.
    return Promise.reject(new Error('IndexedDB open blocked by another connection'));
  }
  if (dbPromise) {
    // An attempt is already in flight. A caller that can afford to wait longer
    // than the grace currently armed — the boot restore joining a write's
    // attempt — raises it: the cache it would otherwise lose is worth the extra
    // spinner, and whoever asked for less is not blocking any UI on it.
    raiseBlockedGrace?.(graceMs);
    return dbPromise;
  }
  /** The wipe epoch this attempt belongs to; see `onsuccess`. */
  const openedAt = epoch;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    /** Whether this request has already produced an outcome for our callers.
     *  An open request cannot be cancelled, so giving up has to disarm the
     *  handlers rather than stop the request. */
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    let grace = graceMs;

    const giveUp = (): void => {
      if (settled) return;
      settled = true;
      raiseBlockedGrace = null;
      // Let a LATER call open from scratch rather than handing every future
      // caller this one rejection — the blocking tab is usually gone by then.
      // The cooldown below is what keeps "later" from meaning "immediately".
      if (dbPromise === attempt) dbPromise = null;
      openBlockedCooldown = true;
      setTimeout(() => {
        openBlockedCooldown = false;
      }, IDB_OPEN_BLOCKED_COOLDOWN_MS);
      // Static string: never attach keys or values, the door's IDB payloads
      // carry guest PII. `idbGet`/`idbSet` swallow the rejection, so without
      // this the frozen-tab case would be invisible in telemetry. The cooldown
      // doubles as the report latch — one per degradation window, not one per
      // failed call.
      captureMessage(
        'door-idb: indexedDB.open stayed blocked by another connection — door storage unavailable',
        'warning',
      );
      reject(new Error('IndexedDB open blocked by another connection'));
    };

    raiseBlockedGrace = (ms: number): void => {
      if (settled || ms <= grace) return;
      grace = ms;
      // Re-arm for the full raised grace rather than the remainder: elapsed time
      // is not tracked here, and erring long only ever costs boot spinner.
      if (blockedTimer) {
        clearTimeout(blockedTimer);
        blockedTimer = setTimeout(giveUp, grace);
      }
    };

    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      raiseBlockedGrace = null;
      if (settled || epoch !== openedAt) {
        // Nobody wants this connection any more, for one of two reasons:
        //
        // - `settled`: the block outlasted the grace period, we already rejected,
        //   and later callers have opened their own connection.
        // - `epoch !== openedAt`: a sign-out wipe (`idbClearAll`) landed while
        //   this attempt was in flight. Adopting it as `dbConn` would hand a
        //   pre-wipe caller a live store belonging to the doorhost who just
        //   signed out — and `idbSet` awaits `openDb()` AFTER the outbox's own
        //   epoch re-check (outbox/store.ts), so that pre-wipe write would land
        //   the previous doorhost's queued check-ins in the next doorhost's
        //   database, on a shared tablet. The epoch guard protects writers at
        //   the point they commit; it cannot protect them while they are parked
        //   inside this open, and `idbClearAll` has no way to mark an in-flight
        //   attempt as abandoned — so the attempt has to check the epoch itself.
        //
        // Either way the connection must be closed: left open and untracked it
        // would block the NEXT version change and defeat `idbClearAll`'s close,
        // re-creating the exact failure this file recovers from. (The abandoned
        // request may also have re-created an empty `plusone-door` via
        // `onupgradeneeded` — harmless, it holds no data, and the next
        // `idbClearAll` deletes it.)
        req.result.close();
        // Reject rather than simply return: an unsettled promise hangs every
        // caller awaiting it, which is the failure mode this whole file exists
        // to remove.
        if (!settled) {
          settled = true;
          if (dbPromise === attempt) dbPromise = null;
          reject(new Error('IndexedDB open abandoned by a sign-out wipe'));
        }
        return;
      }
      settled = true;
      dbConn = req.result;
      // A sibling tab (the Deur tab and the standalone /door/[id] route can both
      // be open) must release its connection when THIS tab runs deleteDatabase,
      // otherwise the delete blocks and the previous doorhost's data survives on
      // disk for the next one. `versionchange` is the standard signal for that.
      req.result.onversionchange = () => {
        req.result.close();
        if (dbConn === req.result) dbConn = null;
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      raiseBlockedGrace = null;
      if (settled) return;
      settled = true;
      reject(req.error);
    };
    // Another connection is holding the old version open. Wait out the busy
    // case, then fail instead of hanging: every idb* helper turns a rejection
    // into a reported miss (`idbGet` -> undefined, `idbSet` -> false, which
    // flips the outbox's `persistDegraded` -> doorhost warning + Sentry), so
    // the door degrades visibly rather than freezing on the restore gate.
    req.onblocked = () => {
      blockedTimer ??= setTimeout(giveUp, grace);
    };
  });
  dbPromise = attempt;
  return attempt;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  graceMs?: number,
): Promise<T> {
  return openDb(graceMs).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/**
 * `graceMs` overrides how long a blocked `indexedDB.open` is waited out for this
 * read — the boot cache restore passes the longer restore grace, because losing
 * that read costs the whole offline guest list (see the constants above).
 */
export async function idbGet<T>(key: string, opts?: { graceMs?: number }): Promise<T | undefined> {
  if (!hasIdb()) return undefined;
  try {
    return (await tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>, opts?.graceMs)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns whether the write actually landed. Callers that only use IndexedDB
 * as a best-effort cache (the RQ persister) can ignore the result; the outbox
 * cannot — a swallowed write failure there silently drops queued check-ins on
 * the next reload (O4), so it surfaces the boolean instead of eating it.
 */
export async function idbSet<T>(key: string, value: T): Promise<boolean> {
  if (!hasIdb()) return false;
  try {
    await tx('readwrite', (s) => s.put(value as unknown as IDBValidKey & T, key));
    return true;
  } catch {
    return false;
  }
}

export async function idbDel(key: string): Promise<void> {
  if (!hasIdb()) return;
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    // ignore
  }
}

/**
 * Drop the entire door store (query cache + outbox). Called on sign-out so a
 * shared venue device never serves one doorhost's guest data to the next person
 * who logs in (spec §5: personal logins on shared devices; CLAUDE.md: no PII leak).
 */
export async function idbClearAll(): Promise<void> {
  // Bump the epoch even when IndexedDB is absent, so any writer that captured the
  // old epoch still no-ops consistently.
  epoch += 1;
  if (!hasIdb()) return;
  // Close our own connection first — otherwise `deleteDatabase` is blocked and
  // deferred until the page navigates away, leaving the data readable on disk in
  // the meantime (and untestable without a real navigation). `close()` waits for
  // in-flight transactions to finish, so nothing is aborted. A sibling tab's
  // connection can still block us; the `onblocked` handler keeps us from hanging
  // and that tab's own sign-out / unload finalizes the delete.
  dbConn?.close();
  dbConn = null;
  dbPromise = null;
  // Drop the blocked-open cooldown: this is a deliberate state reset for the next
  // person on the device, and they must not inherit a fail-fast window opened by
  // the previous doorhost's session (same reasoning as the epoch's "no persistent
  // tombstone" note above). It is time-boxed anyway; this just makes it explicit.
  openBlockedCooldown = false;
  raiseBlockedGrace = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
