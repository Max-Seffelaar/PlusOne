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

  it('guards a door screen that mounts already hidden on its first reveal (86ey6x56p review)', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });
    expect(result.current.phase).toBe('closed'); // mounting hidden alone is not a resume

    // The FIRST visible event this hook ever sees is still a genuine reveal —
    // previously `prevVisibility` seeded to `null` and this was mistaken for
    // "the initial observation" and silently skipped.
    act(() => setVisibility('visible'));

    expect(result.current.phase).toBe('syncing');
    expect(sync.forceSync).toHaveBeenCalledTimes(1);
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

  it('resolves to closed on a fresh lastSyncAt even if `online` is momentarily false (86ey6x56p review — freshness alone is proof)', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), syncing: false });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });

    // The sync that JUST landed a fresh timestamp proves connectivity worked —
    // `online` flickering false at this exact instant must not block the close.
    sync = makeSync({ ...sync, syncing: false, online: false, lastSyncAt: Date.now() });
    rerender({ s: sync });

    expect(result.current.phase).toBe('closed');
  });

  it('retries once before blocking when the settled attempt was a pre-existing/doomed sync (86ey6x56p review)', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), syncing: false });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(sync.forceSync).toHaveBeenCalledTimes(1);

    // A sync that was ALREADY in flight before the resume (not our own
    // forceSync() call, which the shared inFlight guard in useDoorSync may
    // have swallowed) settles unfresh while offline...
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });

    // ...triggers exactly one internal retry instead of blocking immediately.
    expect(result.current.phase).toBe('syncing');
    expect(sync.forceSync).toHaveBeenCalledTimes(2);

    // The retry itself also settles unfresh while offline — NOW it blocks.
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });

    expect(result.current.phase).toBe('blocked');
    expect(result.current.offline).toBe(true);
    expect(sync.forceSync).toHaveBeenCalledTimes(2); // no further auto-retries
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
    rerender({ s: sync }); // consumes the one internal retry
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });
    expect(result.current.phase).toBe('blocked');

    act(() => result.current.continueAnyway());
    expect(result.current.phase).toBe('closed');
  });

  it('retry() re-opens syncing and calls forceSync again from blocked', () => {
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
    sync = makeSync({ ...sync, syncing: true });
    rerender({ s: sync });
    sync = makeSync({ ...sync, syncing: false, online: false });
    rerender({ s: sync });
    expect(result.current.phase).toBe('blocked');
    const callsBeforeRetry = (sync.forceSync as ReturnType<typeof vi.fn>).mock.calls.length;

    act(() => result.current.retry());

    expect(result.current.phase).toBe('syncing');
    expect(sync.forceSync).toHaveBeenCalledTimes(callsBeforeRetry + 1);
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

  it('offline continueAnyway suppresses re-opening on the next resume while still offline (86ey6x56p review)', () => {
    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), online: false });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('syncing');
    act(() => result.current.continueAnyway());
    expect(result.current.phase).toBe('closed');

    // Another screen unlock while STILL offline — already acknowledged, must
    // not re-block on every unlock for the rest of the offline period.
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('closed');
    expect(sync.forceSync).toHaveBeenCalledTimes(1); // only the original attempt

    // Connectivity returns — the suppression clears...
    sync = makeSync({ ...sync, online: true });
    rerender({ s: sync });

    // ...so the NEXT stale resume is guarded normally again.
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('syncing');
    expect(sync.forceSync).toHaveBeenCalledTimes(2);
  });
  // ── Focus restoration across the inert window (86eykg2x1 review round 2) ────
  //
  // Both consumers set `inert` on their own subtree while the overlay is up, and
  // the browser blurs whatever was focused inside it — on the door AddOnSpot's
  // autofocused Enter-to-commit field, on the cockpit the Enter-to-check-in
  // search box. jsdom implements the `inert` ATTRIBUTE but not those focus
  // semantics, so the blur is modelled explicitly below; what is under test is
  // the hand-back, which nothing else performed.

  it('restores focus to the pre-resume element when the guard closes', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.phase).toBe('syncing');
    act(() => field.blur()); // what `inert` does in a real browser
    expect(document.activeElement).toBe(document.body);

    // A fresh sync lands and the guard self-closes — the common online path,
    // where the overlay is visible for about a second and the operator never
    // touches it.
    sync = makeSync({ ...sync, lastSyncAt: Date.now() });
    rerender({ s: sync });
    expect(result.current.phase).toBe('closed');
    expect(document.activeElement).toBe(field);

    field.remove();
  });

  it('restores focus after continueAnyway', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    const sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1), online: false });
    const { result } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    act(() => field.blur());
    act(() => vi.advanceTimersByTime(WAIT_TIMEOUT + 1));
    expect(result.current.phase).toBe('blocked');

    act(() => result.current.continueAnyway());
    expect(result.current.phase).toBe('closed');
    expect(document.activeElement).toBe(field);

    field.remove();
  });

  it('does not steal focus back when it has since landed somewhere real', () => {
    const field = document.createElement('input');
    const elsewhere = document.createElement('input');
    document.body.append(field, elsewhere);
    field.focus();

    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    act(() => field.blur());
    elsewhere.focus();

    sync = makeSync({ ...sync, lastSyncAt: Date.now() });
    rerender({ s: sync });
    expect(result.current.phase).toBe('closed');
    expect(document.activeElement).toBe(elsewhere);

    field.remove();
    elsewhere.remove();
  });

  it('does not restore focus to an element that was unmounted meanwhile', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();

    let sync = makeSync({ lastSyncAt: Date.now() - (THRESHOLD + 1) });
    const { result, rerender } = renderHook(({ s }) => useStaleResumeGuard(s, THRESHOLD, WAIT_TIMEOUT), {
      initialProps: { s: sync },
    });

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    act(() => field.blur());
    field.remove(); // a re-render replaced the subtree while the overlay was up

    sync = makeSync({ ...sync, lastSyncAt: Date.now() });
    rerender({ s: sync });
    expect(result.current.phase).toBe('closed');
    expect(document.activeElement).toBe(document.body);
  });
});
