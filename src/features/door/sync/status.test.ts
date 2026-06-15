import { describe, expect, it } from 'vitest';
import { deriveSyncStatus, syncAgeLabel, STALE_MS, WARN_MS } from './status';

const T0 = 1_000_000_000_000;

describe('deriveSyncStatus', () => {
  it('is live when online, realtime connected and synced within the last minute', () => {
    expect(
      deriveSyncStatus({ online: true, realtimeConnected: true, lastSyncAt: T0 - 5_000, now: T0 }),
    ).toBe('live');
  });

  it('is stale when realtime is down even though we synced recently', () => {
    expect(
      deriveSyncStatus({ online: true, realtimeConnected: false, lastSyncAt: T0 - 5_000, now: T0 }),
    ).toBe('stale');
  });

  it('is stale between 1 and 10 minutes since the last sync', () => {
    expect(
      deriveSyncStatus({ online: true, realtimeConnected: true, lastSyncAt: T0 - (STALE_MS + 1), now: T0 }),
    ).toBe('stale');
  });

  it('is warn after 10 minutes without a sync, even while online', () => {
    expect(
      deriveSyncStatus({ online: true, realtimeConnected: true, lastSyncAt: T0 - WARN_MS, now: T0 }),
    ).toBe('warn');
  });

  it('is stale when briefly offline but warn once offline passes 10 minutes', () => {
    expect(
      deriveSyncStatus({ online: false, realtimeConnected: false, lastSyncAt: T0 - 30_000, now: T0 }),
    ).toBe('stale');
    expect(
      deriveSyncStatus({ online: false, realtimeConnected: false, lastSyncAt: T0 - (WARN_MS + 1), now: T0 }),
    ).toBe('warn');
  });

  it('is stale while connecting (no sync yet)', () => {
    expect(
      deriveSyncStatus({ online: true, realtimeConnected: false, lastSyncAt: null, now: T0 }),
    ).toBe('stale');
  });
});

describe('syncAgeLabel', () => {
  it('formats the spec copy', () => {
    expect(syncAgeLabel(null, T0)).toBe('verbinden…');
    expect(syncAgeLabel(T0 - 3_000, T0)).toBe('zojuist gesynct');
    expect(syncAgeLabel(T0 - 25_000, T0)).toBe('25s geleden');
    expect(syncAgeLabel(T0 - 3 * 60_000, T0)).toBe('laatste sync 3 min geleden');
  });
});
