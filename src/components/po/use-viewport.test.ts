// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useViewport } from './use-viewport';

// jsdom has no matchMedia — stub a controllable one so `update()`/the `change`
// listener can be driven from the test (86ey9e9vc review: unguarded before,
// which also meant this hook was untestable in the CI-required suite).
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const changeListeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (event: string, listener: () => void) => {
      if (event === 'change') changeListeners.add(listener);
    },
    removeEventListener: (event: string, listener: () => void) => {
      if (event === 'change') changeListeners.delete(listener);
    },
  };
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: vi.fn(() => mql) });
  return {
    setMatches: (next: boolean) => {
      matches = next;
    },
    fireChange: (next: boolean) => {
      matches = next;
      act(() => changeListeners.forEach((l) => l()));
    },
    listenerCount: () => changeListeners.size,
  };
}

describe('useViewport', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: originalMatchMedia });
  });

  it('seeds from serverHint, then corrects from matchMedia on mount', () => {
    stubMatchMedia(false); // real breakpoint says desktop
    const { result } = renderHook(() => useViewport(true)); // server guessed mobile
    // The effect runs synchronously under React Testing Library, so the
    // corrected value is already visible.
    expect(result.current).toBe(false);
  });

  it('updates when the media query change listener fires', () => {
    const mm = stubMatchMedia(false);
    const { result } = renderHook(() => useViewport(false));
    expect(result.current).toBe(false);
    mm.fireChange(true);
    expect(result.current).toBe(true);
  });

  it('re-reads matches on a window resize event (DevTools device mode / webview fallback)', () => {
    const mm = stubMatchMedia(false);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { result } = renderHook(() => useViewport(false));
    expect(result.current).toBe(false);
    const resizeHandler = addSpy.mock.calls.find(([event]) => event === 'resize')?.[1] as () => void;
    expect(resizeHandler).toBeDefined();
    mm.setMatches(true);
    act(() => resizeHandler());
    expect(result.current).toBe(true);
    addSpy.mockRestore();
  });

  it('removes both listeners on unmount', () => {
    const mm = stubMatchMedia(false);
    const { unmount } = renderHook(() => useViewport(false));
    expect(mm.listenerCount()).toBe(1);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });

  it('does not throw and keeps the server hint when matchMedia is unavailable (webview guard, #37)', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    const { result } = renderHook(() => useViewport(true));
    expect(result.current).toBe(true);
  });
});
