// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePoHistoryNav } from './history-nav';

type Props = { enabled: boolean; depth: number; popLevel: () => void };
const noop = (): void => {};

/** A real back/forward press: dispatch popstate (manual dispatch doesn't move the
 *  history position, which is fine — the hook decides from its own `armed`/`depth`). */
function pressBack(): void {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

afterEach(() => {
  window.history.replaceState(null, '');
  vi.restoreAllMocks();
});

describe('usePoHistoryNav (single-sentinel model)', () => {
  it('recordPush arms exactly one sentinel and is idempotent', () => {
    const { result } = renderHook((p: Props) => usePoHistoryNav(p), {
      initialProps: { enabled: true, depth: 1, popLevel: noop },
    });
    const pushSpy = vi.spyOn(window.history, 'pushState');

    act(() => result.current.recordPush());
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect((window.history.state as { poSentinel?: boolean } | null)?.poSentinel).toBe(true);

    // Going deeper must NOT add a second entry — the one sentinel stays on top.
    act(() => result.current.recordPush());
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('a real back pops one level and re-arms while still below the root', () => {
    const popLevel = vi.fn();
    const { result, rerender } = renderHook((p: Props) => usePoHistoryNav(p), {
      initialProps: { enabled: true, depth: 2, popLevel },
    });
    act(() => result.current.recordPush()); // arm at depth 2
    const pushSpy = vi.spyOn(window.history, 'pushState');

    pressBack(); // depth 2 → pop to 1, re-arm
    expect(popLevel).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);

    rerender({ enabled: true, depth: 1, popLevel });
    pressBack(); // depth 1 → pop to 0, do NOT re-arm
    expect(popLevel).toHaveBeenCalledTimes(2);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('a back at the tab root does not pop — the app exits cleanly', () => {
    const popLevel = vi.fn();
    renderHook((p: Props) => usePoHistoryNav(p), {
      initialProps: { enabled: true, depth: 0, popLevel },
    });
    pressBack(); // never armed (depth 0)
    expect(popLevel).not.toHaveBeenCalled();
  });

  it('recordReset consumes the sentinel in one guarded back, without popping a level', () => {
    const popLevel = vi.fn();
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(noop);
    const { result } = renderHook((p: Props) => usePoHistoryNav(p), {
      initialProps: { enabled: true, depth: 1, popLevel },
    });
    act(() => result.current.recordPush()); // arm

    act(() => result.current.recordReset());
    expect(backSpy).toHaveBeenCalledTimes(1); // single back, never history.go(-N)

    pressBack(); // the guarded popstate from our own back() must not pop a level
    expect(popLevel).not.toHaveBeenCalled();
  });

  it('goBack is a no-op at the root and drives a back once armed', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(noop);
    const { result } = renderHook((p: Props) => usePoHistoryNav(p), {
      initialProps: { enabled: true, depth: 0, popLevel: noop },
    });

    act(() => result.current.goBack());
    expect(backSpy).not.toHaveBeenCalled(); // not armed → never leaves /app by accident

    act(() => result.current.recordPush()); // arm (depth prop is 0 here, but arm is unconditional)
    act(() => result.current.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('does not listen while disabled', () => {
    const popLevel = vi.fn();
    const { result } = renderHook((p: Props) => usePoHistoryNav(p), {
      initialProps: { enabled: false, depth: 1, popLevel },
    });
    act(() => result.current.recordPush());
    pressBack();
    expect(popLevel).not.toHaveBeenCalled();
  });
});
