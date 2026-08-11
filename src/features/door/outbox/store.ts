/**
 * Persisted outbox store, exposed as a `useSyncExternalStore` source so the UI
 * (sync bar, optimistic state) re-renders as entries move through their
 * lifecycle. One module singleton per tab; entries from every event live here
 * and are drained together. Persisted to IndexedDB so a reload never loses
 * queued work.
 *
 * Cross-tab durability (86ey9e85u — O1/O5/O9): the Deur tab and the standalone
 * /door/[id] route can both be open at once, each with its own in-memory
 * singleton. Every write goes through a read-merge-before-commit (never blind
 * last-writer-wins) serialized per-origin via the Web Locks API where
 * available, and a BroadcastChannel nudges sibling tabs to pick up the merged
 * state without waiting for their own next local mutation.
 */
import { captureMessage as sentryCaptureMessage } from '@/lib/observability/sentry-client';
import { idbEpoch, idbGet, idbSet } from '../offline/idb';
import { buildEnvelope, mergeOutboxEntries, parsePersistedOutbox } from './persistence';
import { resumeStuckEntries, type OutboxEntry } from './types';

const KEY = 'door-outbox';
const LOCK_NAME = 'door-outbox-write';
const CHANNEL_NAME = 'door-outbox-sync';
/**
 * How long a settled-but-not-synced entry (`duplicate` / `error`) is kept after
 * it was created. These are tombstones: nothing will ever replay them again, but
 * they still drive UI — the "duplicaat" marker on a check-in row (CheckInList) —
 * and the manual force-sync retry, so they must outlive the shift they belong to
 * rather than vanish on the next drain. 12h covers a full night (build-up, doors,
 * teardown) and guarantees the queue starts the next event empty instead of
 * carrying every duplicate/quota rejection the venue ever produced, which the
 * old `clearSynced()` kept forever and re-serialized to IndexedDB on every
 * single commit.
 */
const TOMBSTONE_TTL_MS = 12 * 60 * 60 * 1000;
/** Stable empty reference for SSR / first paint (useSyncExternalStore needs it). */
const EMPTY: readonly OutboxEntry[] = Object.freeze([]);

function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' && 'locks' in navigator;
}

let channel: BroadcastChannel | null | undefined;
/** Lazily opened, memoized — `undefined` means "not yet checked", `null` means "unsupported". */
function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

/** Exported (in addition to the `outbox` singleton below) so tests can construct isolated instances. */
export class OutboxStore {
  private entries: OutboxEntry[] = [];
  private loaded = false;
  private listeners = new Set<() => void>();
  private persistDegraded = false;
  private statusListeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;

  constructor() {
    getChannel()?.addEventListener('message', this.onRemoteChange);
  }

  /**
   * Load persisted entries once (called from the provider on mount). The
   * `loaded` guard alone only rejects a call once a PRIOR one has already
   * finished — two calls fired back-to-back before the first's IndexedDB read
   * resolves (React 18 StrictMode's dev-only double-invoke of the mount
   * effect calls this twice with nothing in between) would both pass it and
   * read+merge concurrently. Cache the in-flight promise so a second call
   * while one is already running joins it instead of racing it.
   */
  init(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Mirrors persistMerged/onRemoteChange's wipe-epoch guard: a sign-out
    // (idbClearAll bumps the epoch) landing during this await must not let the
    // continuation repopulate `entries` with the previous user's data, flip
    // `loaded` back to true, and then have persistMerged's own (post-wipe)
    // epoch check pass and write the old user's check-in queue — guest PII —
    // into the next user's clean DB (86ey9et07).
    const epoch = idbEpoch();
    const raw = await idbGet<unknown>(KEY);
    if (epoch !== idbEpoch()) return; // a wipe landed during the read — bail before any state mutation
    const { entries: persisted, droppedInvalid, droppedStaleShape } = parsePersistedOutbox(raw);
    // Revive entries stranded in `syncing` by a mid-drain kill (C8). Persist the
    // normalization immediately so a second crash before the first drain can't
    // re-orphan them.
    const revivedIds = new Set(persisted.filter((e) => e.status === 'syncing').map((e) => e.clientId));
    const revived = resumeStuckEntries(persisted);
    // Fold in anything enqueue()'d locally during the await above (O5 — the old
    // code overwrote `this.entries` outright here, silently dropping it).
    const midAwaitEntries = this.entries;
    this.entries = mergeOutboxEntries(midAwaitEntries, revived);
    this.loaded = true;
    if (droppedInvalid > 0 || droppedStaleShape) {
      // Counts only — never attach the raw dropped entries/payloads here, they
      // can carry guest names (PII).
      sentryCaptureMessage(
        droppedStaleShape
          ? 'door-outbox: dropped stale/unrecognized persisted outbox shape on load'
          : `door-outbox: dropped ${droppedInvalid} invalid persisted outbox entr${droppedInvalid === 1 ? 'y' : 'ies'} on load`,
        'warning',
      );
    }
    this.emit();
    // Only flush back to disk when something actually changed vs. what's there —
    // a revival, a quarantine, or entries that arrived mid-await (O5). The common
    // "nothing persisted, nothing enqueued yet" load skips the extra IDB round-trip.
    const needsFlush = revivedIds.size > 0 || droppedInvalid > 0 || (droppedStaleShape && raw != null) || midAwaitEntries.length > 0;
    // forceIds: the flush below re-reads disk, which at this point still holds
    // the pre-revival `syncing` value (nothing has written yet) — a plain merge
    // ranks `syncing` above `pending` and would revert the revival right back
    // to `syncing` on both memory and disk, permanently re-orphaning the entry
    // (C8 regression, confirmed in review 2026-07-14). Force our just-revived
    // `pending` status through regardless of what the merge would otherwise
    // pick, exactly like `clearSynced()`'s `excludeIds` reasserts a removal.
    if (needsFlush) void this.persistMerged({ forceIds: revivedIds });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly OutboxEntry[] => (this.loaded ? this.entries : EMPTY);

  getServerSnapshot = (): readonly OutboxEntry[] => EMPTY;

  /** Whether the last IndexedDB write failed — drives a UI warning + Sentry (O4). */
  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  getStatusSnapshot = (): boolean => this.persistDegraded;

  getStatusServerSnapshot = (): boolean => false;

  enqueue(entry: OutboxEntry): void {
    this.entries = [...this.entries, entry];
    this.commit();
  }

  update(clientId: string, patch: Partial<OutboxEntry>): void {
    this.entries = this.entries.map((e) =>
      e.clientId === clientId ? ({ ...e, ...patch } as OutboxEntry) : e,
    );
    this.commit();
  }

  /**
   * Drop everything that has finished for good — keeps the queue small over a
   * long night. `synced` goes immediately (the server owns that state now);
   * `duplicate` / `error` tombstones survive `TOMBSTONE_TTL_MS` because the UI
   * and the manual retry still read them, then go too.
   *
   * Before this pruned tombstones, a queue only ever grew: a night's duplicates
   * and quota rejections stayed in memory AND were re-serialized to IndexedDB on
   * every subsequent commit (this runs after every drain — a mutation or the 60s
   * safety sync), so the per-write cost climbed all night on exactly the device
   * that can least afford it. `now` is injectable for tests only.
   */
  clearSettled(now: number = Date.now()): void {
    const cutoff = now - TOMBSTONE_TTL_MS;
    const isExpiredTombstone = (e: OutboxEntry): boolean =>
      (e.status === 'duplicate' || e.status === 'error') && Date.parse(e.createdAt) <= cutoff;
    // The read-merge-before-commit below unions with whatever's on disk, which
    // may still hold these exact entries if a sibling tab hasn't cleared them
    // yet — a plain filter-then-commit would have the removal silently undone
    // by that merge. Passing the removed ids through lets persistMerged() strip
    // them again *after* merging, so the clear actually sticks.
    const removed = new Set(
      this.entries.filter((e) => e.status === 'synced' || isExpiredTombstone(e)).map((e) => e.clientId),
    );
    // Nothing settled since the last call: skip the commit entirely rather than
    // paying a read-merge-write of the whole queue for a no-op.
    if (removed.size === 0) return;
    this.entries = this.entries.filter((e) => !removed.has(e.clientId));
    this.commit({ excludeIds: removed });
  }

  /**
   * Re-queue terminal errors for a manual force-sync retry. Wired to the
   * sync-bar's "sync nu" button ONLY (`onBeforeForceSync` in DoorProvider) —
   * never to the automatic drains, or a dead-lettered entry would retry forever
   * on the 60s safety sync and the dead-letter budget would mean nothing. A
   * doorhost pressing it is deliberately saying "try again": the condition that
   * produced the rejection may genuinely be gone (the list was unlocked, a
   * removal freed a quota slot), and without this there was no recovery path at
   * all short of re-doing the check-in by hand.
   */
  retryErrors(): void {
    // Same revert risk as init()'s revival: the flush below re-reads disk,
    // which still has `error` (rank 1) for these ids — a plain merge would
    // rank it above the freshly-set `pending` (rank 0) and undo the retry.
    // Force it through. attempts resets to 0 too: this is a fresh
    // user-initiated attempt, not an automatic retry, so an entry that had
    // already dead-lettered at MAX_ATTEMPTS shouldn't get only one more try
    // before dead-lettering again (found alongside the init() bug, same root
    // cause — review 2026-07-14).
    const retriedIds = new Set(this.entries.filter((e) => e.status === 'error').map((e) => e.clientId));
    this.entries = this.entries.map((e) =>
      e.status === 'error' ? ({ ...e, status: 'pending', attempts: 0, message: undefined } as OutboxEntry) : e,
    );
    this.commit({ forceIds: retriedIds });
  }

  private commit(opts?: { excludeIds?: Set<string>; forceIds?: Set<string> }): void {
    // Don't persist a partial view while init() is still awaiting its own read
    // (O5) — that read-then-write in init() already covers flushing this state
    // once `loaded` flips true. Still emit so the in-memory UI reacts locally.
    if (!this.loaded) {
      this.emit();
      return;
    }
    void this.persistMerged(opts);
  }

  /**
   * Read-merge-before-commit (O1): never blindly overwrite the persisted
   * value with our in-memory copy. Read what's on disk (which may have been
   * written by a sibling tab since we last synced), union it with our own
   * entries, write the merged result back, and adopt it locally so our own
   * view also reflects the sibling's writes. Serialized per-origin via the
   * Web Locks API where available so two tabs can't race a read-merge-write
   * against each other; falls back to best-effort (still read-merged, just
   * not lock-serialized) where Web Locks is unsupported.
   *
   * `excludeIds` re-applies a clearSynced()-style removal after the merge — a
   * union can only ever add entries back in, never drop ones a sibling's
   * stale on-disk copy still has, so a removal has to be asserted again here.
   *
   * `forceIds` re-applies an intentional *backward* status transition on this
   * tab (init()'s C8 revival, retryErrors()) after the merge. The rank-based
   * merge is correct for reconciling concurrent cross-tab progress but wrong
   * for a local, deliberate step backward — disk still holds the pre-change
   * status (nothing has written yet), outranks the new one, and would revert
   * it right back on both memory and disk. For each id in `forceIds`, the
   * caller's current in-memory entry (captured before the merge) wins
   * unconditionally.
   */
  private async persistMerged(opts?: { excludeIds?: Set<string>; forceIds?: Set<string> }): Promise<void> {
    const mine = this.entries; // snapshot before the merge, for forceIds
    // Capture the wipe epoch at schedule time. A sign-out (idbClearAll) bumps it;
    // if it moved by the time we're about to write, our in-flight read-merge would
    // resurrect A's queued entries into the fresh DB the next user is starting on
    // (misattributing A's check-ins under B on replay), so we bail (86ey9et07).
    const scheduledEpoch = idbEpoch();
    const run = async () => {
      if (scheduledEpoch !== idbEpoch()) return;
      const raw = await idbGet<unknown>(KEY);
      if (scheduledEpoch !== idbEpoch()) return; // a wipe landed during the read
      const { entries: onDisk } = parsePersistedOutbox(raw);
      let merged = mergeOutboxEntries(mine, onDisk);
      if (opts?.excludeIds && opts.excludeIds.size > 0) {
        merged = merged.filter((e) => !opts.excludeIds!.has(e.clientId));
      }
      if (opts?.forceIds && opts.forceIds.size > 0) {
        const forced = new Map(mine.filter((e) => opts.forceIds!.has(e.clientId)).map((e) => [e.clientId, e]));
        merged = merged.map((e) => forced.get(e.clientId) ?? e);
      }
      this.entries = merged;
      const ok = await idbSet(KEY, buildEnvelope(merged));
      this.setPersistDegraded(!ok);
      this.emit();
      getChannel()?.postMessage({ type: 'changed' });
    };
    if (hasWebLocks()) {
      // A stuck/contended lock (a wedged sibling tab, a hung extension, a
      // same-origin script squatting on this lock name) must not silently
      // switch off persistence — `navigator.locks.request` with no signal
      // awaits forever, so `run()` (and therefore `idbSet`) would just never
      // fire while the queue looks healthy. Bound the wait and degrade to the
      // same best-effort unlocked write the no-Web-Locks branch already uses;
      // once the request is aborted the lock manager never invokes `run`, so
      // there is no double-write.
      const signal =
        typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(2000) : undefined;
      try {
        await navigator.locks.request(LOCK_NAME, signal ? { signal } : {}, run);
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
          await run();
        } else {
          throw e;
        }
      }
    } else {
      await run();
    }
  }

  /** A sibling tab committed — pull its entries in without waiting for our own next mutation. */
  private onRemoteChange = (): void => {
    if (!this.loaded) return; // init() will merge in whatever's on disk once it resolves
    const scheduledEpoch = idbEpoch();
    void (async () => {
      const raw = await idbGet<unknown>(KEY);
      // A sign-out wipe during the read must not pull a sibling's stale entries
      // back into memory (they'd re-persist under the next user) — see persistMerged.
      if (scheduledEpoch !== idbEpoch()) return;
      const { entries: onDisk } = parsePersistedOutbox(raw);
      this.entries = mergeOutboxEntries(this.entries, onDisk);
      this.emit();
    })();
  };

  /**
   * Empty the in-memory queue on sign-out (86ey9et07). `idbClearAll` deletes the
   * persisted copy, but this store is a module singleton that outlives a route
   * change; on a shared device the next doorhost must not inherit the previous
   * one's entries. Setting `loaded = false` also makes the next user's `init()`
   * re-read from the (now-clean) DB instead of no-opping on a stale `loaded`.
   * Pairs with the wipe epoch, which stops any already-scheduled write from
   * re-persisting these entries after the reset.
   */
  reset(): void {
    this.entries = [];
    this.loaded = false;
    // A next-user init() arriving while the previous user's load is still in
    // flight must not join that stale pre-wipe promise — invalidate it too so
    // the next init() call starts a fresh doInit() against the wiped epoch.
    this.initPromise = null;
    this.emit();
    this.setPersistDegraded(false);
  }

  private setPersistDegraded(v: boolean): void {
    if (v === this.persistDegraded) return;
    this.persistDegraded = v;
    if (v) {
      // Static string — never attach the failed entries/payloads (guest names are PII).
      sentryCaptureMessage(
        'door-outbox: IndexedDB write failed — queued check-ins are not being saved locally',
        'warning',
      );
    }
    this.statusListeners.forEach((l) => l());
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const outbox = new OutboxStore();
