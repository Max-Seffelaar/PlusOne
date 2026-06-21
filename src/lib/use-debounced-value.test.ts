// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from './use-debounced-value';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits the initial value synchronously', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 140));
    expect(result.current).toBe('a');
  });

  it('only emits the final value after the delay (rapid updates collapse)', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 140), {
      initialProps: { v: 'a' },
    });

    // Type fast: a → ab → abc within the window.
    rerender({ v: 'ab' });
    rerender({ v: 'abc' });
    // Nothing fired yet — still the original.
    expect(result.current).toBe('a');

    // Half the delay: still pending.
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe('a');

    // Past the delay since the LAST change → only the final value lands.
    act(() => vi.advanceTimersByTime(140));
    expect(result.current).toBe('abc');
  });

  it('resets the timer on each change (debounce, not throttle)', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 140), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    act(() => vi.advanceTimersByTime(120)); // not yet
    rerender({ v: 'c' }); // resets the 140ms window
    act(() => vi.advanceTimersByTime(120)); // 120ms since 'c' — still pending
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(40)); // now 160ms since 'c'
    expect(result.current).toBe('c');
  });
});
