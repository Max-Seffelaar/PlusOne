// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTransientValue } from './use-transient-value';

describe('useTransientValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts null, then shows the triggered value until the ttl elapses', () => {
    const { result } = renderHook(() => useTransientValue<string>(1000));
    expect(result.current[0]).toBeNull();

    act(() => result.current[1]('hello'));
    expect(result.current[0]).toBe('hello');

    act(() => vi.advanceTimersByTime(999));
    expect(result.current[0]).toBe('hello');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current[0]).toBeNull();
  });

  it('re-arming clears the earlier timer — an older trigger never wipes a newer value (86ey9ea1g)', () => {
    const { result } = renderHook(() => useTransientValue<string>(1000));

    act(() => result.current[1]('first'));
    act(() => vi.advanceTimersByTime(600)); // first's timer has 400ms left
    act(() => result.current[1]('second')); // re-arms a fresh 1000ms window

    // first's original 1000ms mark passes — must NOT clear 'second'.
    act(() => vi.advanceTimersByTime(400));
    expect(result.current[0]).toBe('second');

    // second's own window elapses.
    act(() => vi.advanceTimersByTime(600));
    expect(result.current[0]).toBeNull();
  });

  it('clears the pending timer on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const { result, unmount } = renderHook(() => useTransientValue<string>(1000));
    act(() => result.current[1]('x'));
    clearSpy.mockClear();

    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('a trigger call after unmount is a no-op — no setState-after-unmount', () => {
    const { result, unmount } = renderHook(() => useTransientValue<string>(1000));
    const trigger = result.current[1]; // hold the reference, as an async completion would

    unmount();

    // Simulates an async mutation callback landing after the component tree
    // is gone — must not throw or warn.
    expect(() => act(() => trigger('too-late'))).not.toThrow();
  });
});
