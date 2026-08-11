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
  const matchMediaSpy = vi.fn(() => mql);
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: matchMediaSpy });
  return {
    matchMediaSpy,
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

// Legacy webview matchMedia stub: only the deprecated addListener/removeListener
// pair (86ey9e9vc review, 2a — same #37 fallback datetime-field.tsx's
// useIsDesktop already carries).
function stubLegacyMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
  };
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: vi.fn(() => mql) });
  return {
    fireChange: (next: boolean) => {
      matches = next;
      act(() => listeners.forEach((l) => l()));
    },
    listenerCount: () => listeners.size,
  };
}

describe('useViewport', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = window.innerWidth;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: originalMatchMedia });
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
  });

  it('seeds from serverHint, then corrects from matchMedia on mount', () => {
    stubMatchMedia(false); // real breakpoint says desktop
    const { result } = renderHook(() => useViewport(true)); // server guessed mobile
    // The effect runs synchronously under React Testing Library, so the
    // corrected value is already visible.
    expect(result.current).toBe(false);
  });

  it('queries the documented 1023px breakpoint (matches ua.ts / the S0 design)', () => {
    const mm = stubMatchMedia(false);
    renderHook(() => useViewport(false));
    expect(mm.matchMediaSpy).toHaveBeenCalledWith('(max-width: 1023px)');
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
  });

  it('removes both the resize and change listeners on unmount', () => {
    const mm = stubMatchMedia(false);
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useViewport(false));
    expect(mm.listenerCount()).toBe(1);
    const resizeHandler = addSpy.mock.calls.find(([event]) => event === 'resize')?.[1];

    unmount();

    expect(mm.listenerCount()).toBe(0);
    // The specific handler registered for 'resize' must be the one removed —
    // asserting listenerCount alone (the `change` side) previously passed
    // even with the `resize` cleanup line deleted (86ey9e9vc review, 3a).
    expect(removeSpy.mock.calls.some(([event, handler]) => event === 'resize' && handler === resizeHandler)).toBe(true);
  });

  it('falls back to the legacy addListener/removeListener pair on a webview without addEventListener (#37)', () => {
    const legacy = stubLegacyMatchMedia(false);
    const { result, unmount } = renderHook(() => useViewport(false));
    expect(result.current).toBe(false);

    legacy.fireChange(true);
    expect(result.current).toBe(true);

    expect(legacy.listenerCount()).toBe(1);
    unmount();
    expect(legacy.listenerCount()).toBe(0);
  });

  it('falls back to window.innerWidth and still corrects when matchMedia is entirely unavailable (86ey9e9vc review, 2a)', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 600 }); // real width says mobile
    // Server guessed desktop — without the innerWidth fallback this used to
    // freeze at `false` forever instead of correcting.
    const { result } = renderHook(() => useViewport(false));
    expect(result.current).toBe(true);
  });

  it('re-reads window.innerWidth on resize when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { result } = renderHook(() => useViewport(false));
    expect(result.current).toBe(false);

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 600 });
    const resizeHandler = addSpy.mock.calls.find(([event]) => event === 'resize')?.[1] as () => void;
    act(() => resizeHandler());
    expect(result.current).toBe(true);
  });

  it('does not throw when matchMedia is unavailable and removes the resize listener on unmount', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useViewport(true));
    expect(() => unmount()).not.toThrow();
    expect(removeSpy.mock.calls.some(([event]) => event === 'resize')).toBe(true);
  });
});
