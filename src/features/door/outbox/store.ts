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
import * as Sentry from '@sentry/nextjs';
import { idbGet, idbSet } from '../offline/idb';
import { buildEnvelope, mergeOutboxEntries, parsePersistedOutbox } from './persistence';
import { resumeStuckEntries, type OutboxEntry } from './types';

const KEY = 'door-outbox';
const LOCK_NAME = 'door-outbox-write';
const CHANNEL_NAME = 'door-outbox-sync';
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

  constructor() {
    getChannel()?.addEventListener('message', this.onRemoteChange);
  }

  /** Load persisted entries once (called from the provider on mount). */
  async init(): Promise<void> {
    if (this.loaded) return;
    const raw = await idbGet<unknown>(KEY);
    const { entries: persisted, droppedInvalid, droppedStaleShape } = parsePersistedOutbox(raw);
    // Revive entries stranded in `syncing` by a mid-drain kill (C8). Persist the
    // normalization immediately so a second crash before the first drain can't
    // re-orphan them.
    const anyRevived = persisted.some((e) => e.status === 'syncing');
    const revived = resumeStuckEntries(persisted);
    // Fold in anything enqueue()'d locally during the await above (O5 — the old
    // code overwrote `this.entries` outright here, silently dropping it).
    const midAwaitEntries = this.entries;
    this.entries = mergeOutboxEntries(midAwaitEntries, revived);
    this.loaded = true;
    if (droppedInvalid > 0 || droppedStaleShape) {
      // Counts only — never attach the raw dropped entries/payloads here, they
      // can carry guest names (PII).
      Sentry.captureMessage(
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
    const needsFlush = anyRevived || droppedInvalid > 0 || (droppedStaleShape && raw != null) || midAwaitEntries.length > 0;
    if (needsFlush) void this.persistMerged();
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

  /** Drop entries that fully synced — keeps the queue small over a long night. */
  clearSynced(): void {
    // The read-merge-before-commit below unions with whatever's on disk, which
    // may still hold these exact entries if a sibling tab hasn't cleared them
    // yet — a plain filter-then-commit would have the removal silently undone
    // by that merge. Passing the removed ids through lets persistMerged() strip
    // them again *after* merging, so the clear actually sticks.
    const removed = new Set(this.entries.filter((e) => e.status === 'synced').map((e) => e.clientId));
    this.entries = this.entries.filter((e) => e.status !== 'synced');
    this.commit(removed);
  }

  /** Re-queue terminal errors for a manual force-sync retry. */
  retryErrors(): void {
    this.entries = this.entries.map((e) =>
      e.status === 'error' ? ({ ...e, status: 'pending', message: undefined } as OutboxEntry) : e,
    );
    this.commit();
  }

  private commit(excludeIds?: Set<string>): void {
    // Don't persist a partial view while init() is still awaiting its own read
    // (O5) — that read-then-write in init() already covers flushing this state
    // once `loaded` flips true. Still emit so the in-memory UI reacts locally.
    if (!this.loaded) {
      this.emit();
      return;
    }
    void this.persistMerged(excludeIds);
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
   */
  private async persistMerged(excludeIds?: Set<string>): Promise<void> {
    const run = async () => {
      const raw = await idbGet<unknown>(KEY);
      const { entries: onDisk } = parsePersistedOutbox(raw);
      let merged = mergeOutboxEntries(this.entries, onDisk);
      if (excludeIds && excludeIds.size > 0) merged = merged.filter((e) => !excludeIds.has(e.clientId));
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
    void (async () => {
      const raw = await idbGet<unknown>(KEY);
      const { entries: onDisk } = parsePersistedOutbox(raw);
      this.entries = mergeOutboxEntries(this.entries, onDisk);
      this.emit();
    })();
  };

  private setPersistDegraded(v: boolean): void {
    if (v === this.persistDegraded) return;
    this.persistDegraded = v;
    if (v) {
      // Static string — never attach the failed entries/payloads (guest names are PII).
      Sentry.captureMessage(
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
