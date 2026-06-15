/**
 * Persisted outbox store, exposed as a `useSyncExternalStore` source so the UI
 * (sync bar, optimistic state) re-renders as entries move through their
 * lifecycle. One module singleton; entries from every event live here and are
 * drained together. Persisted to IndexedDB so a reload never loses queued work.
 */
import { idbGet, idbSet } from '../offline/idb';
import type { OutboxEntry } from './types';

const KEY = 'door-outbox';
/** Stable empty reference for SSR / first paint (useSyncExternalStore needs it). */
const EMPTY: readonly OutboxEntry[] = Object.freeze([]);

class OutboxStore {
  private entries: OutboxEntry[] = [];
  private loaded = false;
  private listeners = new Set<() => void>();

  /** Load persisted entries once (called from the provider on mount). */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.entries = (await idbGet<OutboxEntry[]>(KEY)) ?? [];
    this.loaded = true;
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly OutboxEntry[] => (this.loaded ? this.entries : EMPTY);

  getServerSnapshot = (): readonly OutboxEntry[] => EMPTY;

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
    this.entries = this.entries.filter((e) => e.status !== 'synced');
    this.commit();
  }

  /** Re-queue terminal errors for a manual force-sync retry. */
  retryErrors(): void {
    this.entries = this.entries.map((e) =>
      e.status === 'error' ? ({ ...e, status: 'pending', message: undefined } as OutboxEntry) : e,
    );
    this.commit();
  }

  private commit(): void {
    void idbSet(KEY, this.entries);
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const outbox = new OutboxStore();
