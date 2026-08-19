// @vitest-environment jsdom
/**
 * The cockpit's React-Query→`StaleResumeSyncSource` adapter (86eykg2x1). What is
 * verified here is the contract `useStaleResumeGuard` relies on — anything the
 * guard reads wrongly here would silently disarm the guard on this surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { useCockpitSync } from './useCockpitSync';
import type { QueryFreshness } from './cockpitFreshness';

const q = (dataUpdatedAt: number): QueryFreshness => ({ dataUpdatedAt });

/** A `refresh` whose promise the test settles by hand, so "the forced refresh is
 *  still running" is an explicit state rather than a timing accident. */
function deferredRefresh() {
  let settle: () => void = () => undefined;
  const fn = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
  return { fn, settle: () => settle() };
}

describe('useCockpitSync', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
  });
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('reports the oldest tracked load as lastSyncAt', () => {
    const { result } = renderHook(() =>
      useCockpitSync({ tracked: [q(5_000), q(1_000), q(9_000)], refresh: vi.fn(async () => undefined) }),
    );
    expect(result.current.lastSyncAt).toBe(1_000);
  });

  it('reports lastSyncAt null while any tracked query has never loaded', () => {
    // Feeds straight into isSyncStale(null, …) === true, i.e. "never synced".
    const { result } = renderHook(() =>
      useCockpitSync({ tracked: [q(5_000), q(0)], refresh: vi.fn(async () => undefined) }),
    );
    expect(result.current.lastSyncAt).toBeNull();
  });

  it('reports syncing only while ITS OWN forced refresh is running', async () => {
    const { fn, settle } = deferredRefresh();
    const { result } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: fn }));
    expect(result.current.syncing).toBe(false);

    act(() => result.current.forceSync());
    expect(result.current.syncing).toBe(true);

    await act(async () => {
      settle();
    });
    expect(result.current.syncing).toBe(false);
  });

  it('does NOT report syncing for ambient cockpit traffic', async () => {
    // The regression this replaced (86eykg2x1 review round 2): `syncing` used to
    // mean "any tracked query is fetching". The four tracked reads are on a 60s
    // refetchInterval AND are invalidated by usePoEventRealtime on every check-in
    // (throttled to 500ms), so during a door rush that is near-continuous — and
    // `useStaleResumeGuard` bails out of its resolve effect while `syncing` is
    // true, so the blocking overlay could not close over a demonstrably fresh
    // cockpit, then hit the 8s backstop and claim the connection was stuck.
    // Query churn alone must never read as "the resume refresh is running".
    const { result, rerender } = renderHook(
      ({ tracked }) => useCockpitSync({ tracked, refresh: vi.fn(async () => undefined) }),
      { initialProps: { tracked: [q(1_000), q(2_000)] as QueryFreshness[] } },
    );
    expect(result.current.syncing).toBe(false);

    // A realtime invalidation lands and the polled reads refetch: stamps move,
    // the queries churn. None of that is this guard's attempt.
    rerender({ tracked: [q(3_000), q(2_000)] });
    expect(result.current.syncing).toBe(false);
    rerender({ tracked: [q(3_000), q(4_000)] });
    expect(result.current.syncing).toBe(false);
  });

  it('keeps syncing true while a refresh React Query has PAUSED stays pending', () => {
    // Offline, RQ pauses the refetch rather than running it and the promise stays
    // pending. That must keep reading as in-flight: the attempt exists and will
    // resume by itself once connectivity returns, so reporting it as settled
    // would tell the guard the refresh already failed when it has not been tried.
    // The guard's 8s backstop is what bounds the wait.
    const { fn } = deferredRefresh();
    const { result } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: fn }));
    act(() => result.current.forceSync());
    expect(result.current.syncing).toBe(true);
  });

  it('stays syncing until the LAST outstanding forced refresh settles', async () => {
    // The guard fires a second forced refresh on its one internal retry; the
    // first must not clear the flag out from under the second.
    const a = deferredRefresh();
    const { result, rerender } = renderHook(
      ({ refresh }) => useCockpitSync({ tracked: [q(1_000)], refresh }),
      { initialProps: { refresh: a.fn } },
    );
    act(() => result.current.forceSync());
    const b = deferredRefresh();
    rerender({ refresh: b.fn });
    act(() => result.current.forceSync());
    expect(result.current.syncing).toBe(true);

    await act(async () => {
      a.settle();
    });
    expect(result.current.syncing).toBe(true);

    await act(async () => {
      b.settle();
    });
    expect(result.current.syncing).toBe(false);
  });

  it('survives a refresh that rejects — a failed refresh just leaves the data stale', async () => {
    const boom = vi.fn(() => Promise.reject(new Error('network')));
    const { result } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: boom }));
    await act(async () => {
      result.current.forceSync();
    });
    // Settled, not stuck — the guard then acts on `lastSyncAt`, which never moved.
    expect(result.current.syncing).toBe(false);
    expect(result.current.lastSyncAt).toBe(1_000);
  });

  it('forceSync calls refresh, and keeps a STABLE identity across renders', async () => {
    // The guard registers its visibilitychange listener once and holds whatever
    // `forceSync` existed then; an unstable identity there would be a live bug.
    const first = vi.fn(async () => undefined);
    const { result, rerender } = renderHook(
      ({ refresh }) => useCockpitSync({ tracked: [q(1_000)], refresh }),
      { initialProps: { refresh: first } },
    );
    const captured = result.current.forceSync;

    const second = vi.fn(async () => undefined);
    rerender({ refresh: second });
    expect(result.current.forceSync).toBe(captured);

    // ...and the captured closure must reach the CURRENT refresh, not the stale one.
    await act(async () => {
      captured();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tracks React Query’s online signal', () => {
    onlineManager.setOnline(false);
    const { result, unmount } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: vi.fn(async () => undefined) }));
    expect(result.current.online).toBe(false);

    act(() => onlineManager.setOnline(true));
    expect(result.current.online).toBe(true);

    act(() => onlineManager.setOnline(false));
    expect(result.current.online).toBe(false);
    // Unmount before afterEach flips the manager back, so that reset does not
    // land on a still-mounted hook outside act().
    unmount();
  });

  it('unsubscribes from the online manager on unmount', () => {
    const { unmount } = renderHook(() => useCockpitSync({ tracked: [q(1_000)], refresh: vi.fn(async () => undefined) }));
    const before = onlineManager.hasListeners();
    unmount();
    // No listener leak: with nothing else subscribed the manager goes quiet.
    expect(before).toBe(true);
    expect(onlineManager.hasListeners()).toBe(false);
  });
});
