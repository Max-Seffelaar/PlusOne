// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';
import type { WakeLockSentinelLike } from './wakeLock';

interface FakeSentinel extends WakeLockSentinelLike {
  /** Simulates the browser's OWN automatic release when the document goes
   *  hidden (per spec, distinct from an application calling `.release()`) —
   *  fires the same 'release' event without going through the release() method. */
  simulateOsRelease: () => void;
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
  });
}

describe('useWakeLock', () => {
  afterEach(() => stubWakeLock(undefined));

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

  it('toggle off releases the held sentinel', async () => {
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
});
