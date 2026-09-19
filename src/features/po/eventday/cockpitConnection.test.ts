import { describe, expect, it } from 'vitest';
import { STALE_MS, WARN_MS } from '@/features/door/sync/status';
import { cockpitConnection } from './cockpitConnection';

const NOW = Date.parse('2026-09-18T22:00:00Z');
const fresh = NOW - 5_000;

describe('cockpitConnection', () => {
  it('is live when online, realtime connected and synced within the last minute', () => {
    expect(cockpitConnection({ online: true, realtimeConnected: true, lastSyncAt: fresh, now: NOW })).toEqual({
      status: 'live',
      kind: 'live',
    });
  });

  it('is stale (gold) and reads as delayed when realtime is down but the device is online', () => {
    expect(cockpitConnection({ online: true, realtimeConnected: false, lastSyncAt: fresh, now: NOW })).toEqual({
      status: 'stale',
      kind: 'stale',
    });
  });

  it('is stale when the last sync is a minute or more old, even with realtime up', () => {
    const r = cockpitConnection({ online: true, realtimeConnected: true, lastSyncAt: NOW - STALE_MS, now: NOW });
    expect(r).toEqual({ status: 'stale', kind: 'stale' });
  });

  it('keeps the stale dot but names it offline when the device is offline', () => {
    expect(cockpitConnection({ online: false, realtimeConnected: true, lastSyncAt: fresh, now: NOW })).toEqual({
      status: 'stale',
      kind: 'offline',
    });
  });

  it('warns (red) after ten minutes without a sync, online or not', () => {
    const old = NOW - WARN_MS;
    expect(cockpitConnection({ online: true, realtimeConnected: true, lastSyncAt: old, now: NOW }).kind).toBe('warn');
    expect(cockpitConnection({ online: false, realtimeConnected: false, lastSyncAt: old, now: NOW })).toEqual({
      status: 'warn',
      kind: 'warn',
    });
  });

  it('is never live before the first successful sync', () => {
    expect(cockpitConnection({ online: true, realtimeConnected: true, lastSyncAt: null, now: NOW }).kind).toBe('stale');
  });
});
