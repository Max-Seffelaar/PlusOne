// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStaleResumeGuard } from './useStaleResumeGuard';
import type { DoorSyncState } from './useDoorSync';

const THRESHOLD = 5 * 60_000;
const WAIT_TIMEOUT = 8_000;

function makeSync(overrides: Partial<DoorSyncState> = {}): DoorSyncState {
  return {
    status: 'live',
    ageLabel: 'synced just now',
    online: true,
    realtimeConnected: true,
    syncing: false,
    lastSyncAt: Date.now(),
    forceSync: vi.fn(),
    ...overrides,
  };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useStaleResumeGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and does nothing on mount', () => {
    const sync = makeSync();
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });
    expect(result.current.phase).toBe('closed');
    expect(sync.forceSync).not.toHaveBeenCalled();
  });

  it('opens + forces a sync on a genuine resume with a stale last sync', () => {
    const sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));

    expect(result.current.phase).toBe('syncing');
    expect(sync.forceSync).toHaveBeenCalledTimes(1);
  });

  it('does not open when the last sync is still fresh on resume', () => {
    const sync = makeSync({ lastSyncAt: Date.now() - 10_000 });
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));

    expect(result.current.phase).toBe('closed');
    expect(sync.forceSync).not.toHaveBeenCalled();
  });

  it('does not open on a visible→visible no-op or a hidden transition', () => {
    const sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('visible')); // no-op, already visible
    act(() => setVisibility('hidden')); // going away, not resuming
    expect(result.current.phase).toBe('closed');
    expect(sync.forceSync).not.toHaveBeenCalled();
  });

  it('resolves online → closed once the forced sync settles fresh', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), syncing: false });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('syncing');

    // The sync begins (syncing flips true)...
    sync = makeSync({ ...sync, syncing: true, lastSyncAt: sync.lastSyncAt });
    rerender({ s: sync });
    expect(result.current.phase).toBe('syncing');

    // ...and settles successfully.
    sync = makeSync({ ...sync, syncing: false, online: true, lastSyncAt: Date.now() });
    rerender({ s: sync });

    expect(result.current.phase).toBe('closed');
    expect(result.current.offline).toBe(false);
  });

  it('degrades to blocked when the forced sync settles while offline', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), syncing: false });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('syncing');

    // The forced sync actually starts (this is what useDoorSync's own
    // visibilitychange listener does in the same event dispatch)...
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    expect(result.current.phase).toBe('syncing');

    // ...then settles while offline.
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });

    expect(result.current.phase).toBe('blocked');
    expect(result.current.offline).toBe(true);
  });

  it('continueAnyway dismisses a blocked overlay', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });
    expect(result.current.phase).toBe('blocked');

    act(() => result.current.continueAnyway());
    expect(result.current.phase).toBe('closed');
  });

  it('never leaves the door blocked forever — a hung sync trips the backstop timeout', () => {
    const sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), syncing: false, online: true });
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('syncing');

    // `syncing` never flips (a genuinely stuck request) — the backstop fires.
    act(() => {
      vi.advanceTimersByTime(WAIT_TIMEOUT);
    });

    expect(result.current.phase).toBe('blocked');
  });

  it('self-heals blocked → closed once a LATER background sync succeeds (not just the forced one)', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), syncing: false, online: false });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });
    expect(result.current.phase).toBe('blocked');

    // Connectivity returns and a LATER sync (e.g. the 60s safety interval,
    // not this guard's own forced attempt) lands successfully.
    act(() => vi.advanceTimersByTime(30_000));
    sync = makeSync({ ...sync, online: true, lastSyncAt: Date.now() });
    rerender({ s: sync });

    expect(result.current.phase).toBe('closed');
  });
});
