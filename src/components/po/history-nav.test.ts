// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePoHistoryNav } from './history-nav';

/** Deliver a popstate exactly as a back/forward press would, carrying the target
 *  entry's state (manual dispatch does NOT mutate window.history.state — the hook
 *  reads `e.state`, which is what we exercise here). */
function pressBack(state: unknown): void {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
  });
}

afterEach(() => {
  window.history.replaceState(null, '');
  vi.restoreAllMocks();
});

describe('usePoHistoryNav', () => {
  it('recordPush stamps an incrementing poDepth onto history.state', () => {
    const { result } = renderHook(() => usePoHistoryNav({ enabled: true, popLevel: () => {} }));

    act(() => result.current.recordPush());
    expect((window.history.state as { poDepth?: number } | null)?.poDepth).toBe(1);

    act(() => result.current.recordPush());
    expect((window.history.state as { poDepth?: number } | null)?.poDepth).toBe(2);
  });

  it('a real back (popstate to a lower poDepth) pops exactly one in-app level', () => {
    const popLevel = vi.fn();
    const { result } = renderHook(() => usePoHistoryNav({ enabled: true, popLevel }));
    act(() => {
      result.current.recordPush();
      result.current.recordPush();
    });

    pressBack({ poDepth: 1 });
    expect(popLevel).toHaveBeenCalledTimes(1);

    // A forward / same-depth move must NOT pop again.
    pressBack({ poDepth: 2 });
    expect(popLevel).toHaveBeenCalledTimes(1);
  });

  it('back at the tab root (a popstate with no poDepth) does not pop — the app exits cleanly', () => {
    const popLevel = vi.fn();
    renderHook(() => usePoHistoryNav({ enabled: true, popLevel }));

    pressBack(null); // landed on a foreign entry (e.g. baseline /app) → no in-app pop
    expect(popLevel).not.toHaveBeenCalled();
  });

  it('goBack is a no-op at the root and drives history.back once a screen is pushed', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { result } = renderHook(() => usePoHistoryNav({ enabled: true, popLevel: () => {} }));

    act(() => result.current.goBack());
    expect(backSpy).not.toHaveBeenCalled(); // depth 0 → never accidentally leaves /app

    act(() => result.current.recordPush());
    act(() => result.current.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('recordReset rewinds exactly the entries it pushed and swallows its own popstate', () => {
    const popLevel = vi.fn();
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const { result } = renderHook(() => usePoHistoryNav({ enabled: true, popLevel }));
    act(() => {
      result.current.recordPush();
      result.current.recordPush();
    });

    act(() => result.current.recordReset());
    expect(goSpy).toHaveBeenCalledWith(-2);

    // The guarded popstate fired by our own history.go must not pop an in-app level.
    pressBack({ poDepth: 0 });
    expect(popLevel).not.toHaveBeenCalled();
  });

  it('does not listen while disabled', () => {
    const popLevel = vi.fn();
    renderHook(() => usePoHistoryNav({ enabled: false, popLevel }));

    pressBack({ poDepth: -1 });
    expect(popLevel).not.toHaveBeenCalled();
  });
});
