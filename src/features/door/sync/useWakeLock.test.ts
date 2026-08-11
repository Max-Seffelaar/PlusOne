// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { useWakeLock } from './useWakeLock';
import { writeWakeLockOffPreference } from './wakeLock';
import type { WakeLockSentinelLike } from './wakeLock';

interface FakeSentinel extends WakeLockSentinelLike {
  /** Simulates the browser's OWN automatic release when the document goes
   *  hidden (per spec, distinct from an application calling `.release()`) —
   *  fires the same 'release' event without going through the release() method. */
  simulateOsRelease: () => void;
  /** Simulates a dead sentinel whose `.released` flips true WITHOUT the
   *  'release' event ever firing — the documented iOS pre-18.4 gap. */
  goStaleSilently: () => void;
}

function fakeSentinel(): FakeSentinel {
  let released = false;
  const listeners = new Set<() => void>();
  return {
    get released() {
      return released;
    },
    release: vi.fn(async () => {
      released = true;
      listeners.forEach((l) => l());
    }),
    addEventListener: vi.fn((_type, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type, listener: () => void) => {
      listeners.delete(listener);
    }),
    simulateOsRelease: () => {
      released = true;
      listeners.forEach((l) => l());
    },
    goStaleSilently: () => {
      released = true;
    },
  };
}

function stubWakeLock(request: ((type: 'screen') => Promise<WakeLockSentinelLike>) | undefined): void {
  if (request) {
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  } else {
    Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
  }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useWakeLock', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    stubWakeLock(undefined);
    window.localStorage.clear();
  });

  it('renders supported=false when server-rendered (86ey6x56p review — no effects run under SSR, so this is exactly what hydration must match)', () => {
    // Even with a wakeLock API present in this environment, `renderToString`
    // never runs effects — it can only reflect the useState INITIALIZER, which
    // is the whole point of the fix: it must be `false`, matching what a real
    // Node SSR pass (no navigator.wakeLock at all) would also render.
    stubWakeLock(async () => fakeSentinel());
    function Probe(): JSX.Element {
      const { supported } = useWakeLock();
      return createElement('span', null, String(supported));
    }
    const html = renderToString(createElement(Probe));
    expect(html).toContain('false');
  });

  it('reports unsupported and never calls the API when navigator.wakeLock is absent', async () => {
    stubWakeLock(undefined);
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.supported).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it('defaults to enabled + acquires a lock on mount when supported', async () => {
    const sentinel = fakeSentinel();
    stubWakeLock(async () => sentinel);
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.supported).toBe(true);
    expect(result.current.enabled).toBe(true);
    expect(result.current.active).toBe(true);
  });

  it('mounts disabled when a prior session persisted an explicit OFF (86ey6x56p review)', async () => {
    writeWakeLockOffPreference(true);
    const sentinel = fakeSentinel();
    stubWakeLock(async () => sentinel);
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.supported).toBe(true);
    expect(result.current.enabled).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it('toggle off releases the held sentinel and persists the preference', async () => {
    const sentinel = fakeSentinel();
    stubWakeLock(async () => sentinel);
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.active).toBe(true);

    act(() => result.current.toggle());
    await flush();

    expect(result.current.enabled).toBe(false);
    expect(result.current.active).toBe(false);
    expect(sentinel.release).toHaveBeenCalledTimes(1);

    // A fresh mount (new session/reload) must remember the OFF choice.
    const { result: second } = renderHook(() => useWakeLock());
    await flush();
    expect(second.current.enabled).toBe(false);

    // Toggling back on clears the persisted preference.
    act(() => result.current.toggle());
    await flush();
    expect(result.current.enabled).toBe(true);
  });

  it('re-acquires on visibilitychange → visible while enabled (the resume requirement)', async () => {
    let calls = 0;
    const sentinels: FakeSentinel[] = [];
    stubWakeLock(async () => {
      calls += 1;
      const s = fakeSentinel();
      sentinels.push(s);
      return s;
    });
    renderHook(() => useWakeLock());
    await flush();
    expect(calls).toBe(1);

    // The OS auto-releases the sentinel (firing its 'release' event) the
    // instant the document goes hidden — simulate that exactly as the real
    // Wake Lock API does, then simulate the door screen coming back.
    act(() => sentinels[0]?.simulateOsRelease());
    setVisibility('hidden');
    await flush();
    setVisibility('visible');
    await flush();

    expect(calls).toBe(2);
  });

  it('re-acquires when the browser revokes the lock while STILL visible (86ey6x56p review — battery-saver style revocation, not a visibilitychange)', async () => {
    let calls = 0;
    const sentinels: FakeSentinel[] = [];
    stubWakeLock(async () => {
      calls += 1;
      const s = fakeSentinel();
      sentinels.push(s);
      return s;
    });
    renderHook(() => useWakeLock());
    await flush();
    expect(calls).toBe(1);

    // No visibility change at all — the browser just revokes it (documented
    // MDN case). The previous implementation only re-acquired on resume and
    // would silently stay "enabled but not active" forever after this.
    act(() => sentinels[0]?.simulateOsRelease());
    await flush();

    expect(calls).toBe(2);
  });

  it('does not re-acquire on resume once the doorhost turned the toggle off', async () => {
    let calls = 0;
    stubWakeLock(async () => {
      calls += 1;
      return fakeSentinel();
    });
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(calls).toBe(1);

    act(() => result.current.toggle()); // off
    await flush();

    setVisibility('hidden');
    setVisibility('visible');
    await flush();

    expect(calls).toBe(1);
    expect(result.current.active).toBe(false);
  });

  it('releases the sentinel on unmount', async () => {
    const sentinel = fakeSentinel();
    stubWakeLock(async () => sentinel);
    const { unmount } = renderHook(() => useWakeLock());
    await flush();
    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('immediately releases a sentinel that resolves after the toggle was already turned off (in-flight race)', async () => {
    let resolveRequest: ((s: WakeLockSentinelLike) => void) | null = null;
    const sentinel = fakeSentinel();
    stubWakeLock(
      () =>
        new Promise<WakeLockSentinelLike>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { result } = renderHook(() => useWakeLock());
    await act(async () => {
      await Promise.resolve();
    });

    // Turn the toggle off WHILE the initial request is still pending.
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);

    // Now the browser grants the lock, after the fact.
    await act(async () => {
      resolveRequest?.(sentinel);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.active).toBe(false);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('releases a sentinel from a concurrent acquire that lost the race (86ey6x56p review)', async () => {
    const resolvers: Array<(s: WakeLockSentinelLike) => void> = [];
    const sentinels = [fakeSentinel(), fakeSentinel()];
    stubWakeLock(
      () =>
        new Promise<WakeLockSentinelLike>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderHook(() => useWakeLock());
    await flush(); // mount kicks off acquire #1 (request pending, resolvers[0] captured)
    expect(resolvers).toHaveLength(1);

    // A SECOND overlapping acquire, e.g. a resume firing while the first
    // request is still outstanding — sentinelRef is still null, so it
    // independently starts its own request too.
    act(() => setVisibility('visible'));
    expect(resolvers).toHaveLength(2);

    // The first request wins the race and is committed...
    await act(async () => {
      resolvers[0](sentinels[0]);
      await Promise.resolve();
      await Promise.resolve();
    });

    // ...then the second (now-redundant) sentinel resolves and must be
    // released immediately rather than orphaned or clobbering the held one.
    await act(async () => {
      resolvers[1](sentinels[1]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sentinels[0].release).not.toHaveBeenCalled();
    expect(sentinels[1].release).toHaveBeenCalledTimes(1);
  });

  it('treats a silently-dead sentinel (no release event fired) as not held and recovers on the next resume (86ey6x56p review — iOS pre-18.4 gap)', async () => {
    let calls = 0;
    const sentinels: FakeSentinel[] = [];
    stubWakeLock(async () => {
      calls += 1;
      const s = fakeSentinel();
      sentinels.push(s);
      return s;
    });
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.active).toBe(true);

    // The sentinel goes stale WITHOUT firing 'release' — without the fix,
    // `sentinelRef.current` stays truthy forever and every future acquire()
    // silently no-ops, even though `enabled` is still true.
    sentinels[0].goStaleSilently();

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await flush();

    expect(calls).toBe(2); // a real second request was made, not swallowed
    expect(result.current.active).toBe(true);
  });

  it('does not permanently disable acquisition after a StrictMode double-invoked mount (86ey6x56p review — liveRef reset)', async () => {
    const sentinel = fakeSentinel();
    stubWakeLock(async () => sentinel);
    const { result } = renderHook(() => useWakeLock(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    });
    await flush();
    // Without resetting `liveRef.current = true` on every mount, StrictMode's
    // dev-only simulated unmount+remount would leave it stuck `false` here,
    // and every acquire() from then on would immediately self-release.
    expect(result.current.active).toBe(true);
  });
});
