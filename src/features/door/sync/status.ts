/**
 * Sync-status derivation for the permanent door status bar (spec §4 point 4):
 *   live  (green)  — online, realtime connected, synced in the last minute
 *   stale (orange) — online but realtime down / 1–10 min since last sync, or
 *                    briefly offline (< 10 min)
 *   warn  (red)    — more than 10 minutes without a successful sync
 *
 * Pure function so it is unit-tested in isolation.
 */

export type SyncStatus = 'live' | 'stale' | 'warn';

export interface SyncInputs {
  online: boolean;
  realtimeConnected: boolean;
  /** Epoch ms of the last successful full sync, or null if never. */
  lastSyncAt: number | null;
  now: number;
}

export const STALE_MS = 60_000; // 1 minute
export const WARN_MS = 10 * 60_000; // 10 minutes (spec: warn after 10 min)

export function deriveSyncStatus({ online, realtimeConnected, lastSyncAt, now }: SyncInputs): SyncStatus {
  const elapsed = lastSyncAt == null ? null : now - lastSyncAt;
  // Critical: >10 min without a successful sync — regardless of the online flag.
  if (elapsed != null && elapsed >= WARN_MS) return 'warn';
  if (!online) return 'stale';
  if (realtimeConnected && elapsed != null && elapsed < STALE_MS) return 'live';
  return 'stale';
}

/** Human label for the bar ("last sync 3 min ago", "synced just now", "connecting…"). */
export function syncAgeLabel(lastSyncAt: number | null, now: number): string {
  if (lastSyncAt == null) return 'connecting…';
  const sec = Math.max(0, Math.floor((now - lastSyncAt) / 1000));
  if (sec < 10) return 'synced just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `last sync ${min} min ago`;
}
