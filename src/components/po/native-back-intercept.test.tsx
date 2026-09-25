// @vitest-environment jsdom
/**
 * Native back intercepts (86ey6bfdm follow-up): the stack that lets local
 * overlay state claim the Android back button before any navigation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import {
  runNativeBackIntercept,
  runNativeLeaveGuard,
  useNativeBackIntercept,
  useNativeLeaveGuard,
} from './native-back-intercept';

afterEach(cleanup);

describe('useNativeBackIntercept', () => {
  it('nothing registered → back is not handled', () => {
    expect(runNativeBackIntercept()).toBe(false);
  });

  it('an inactive (null) intercept never swallows back', () => {
    renderHook(() => useNativeBackIntercept(null));
    expect(runNativeBackIntercept()).toBe(false);
  });

  it('an active intercept handles back and calls the latest handler', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(({ fn }) => useNativeBackIntercept(fn), { initialProps: { fn: first } });
    rerender({ fn: latest });
    expect(runNativeBackIntercept()).toBe(true);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('deactivating or unmounting unregisters it', () => {
    const fn = vi.fn();
    const { rerender, unmount } = renderHook(({ on }: { on: boolean }) => useNativeBackIntercept(on ? fn : null), {
      initialProps: { on: true },
    });
    rerender({ on: false });
    expect(runNativeBackIntercept()).toBe(false);
    rerender({ on: true });
    expect(runNativeBackIntercept()).toBe(true);
    unmount();
    expect(runNativeBackIntercept()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('the newest active intercept wins (topmost sheet first)', () => {
    const lower = vi.fn();
    const upper = vi.fn();
    renderHook(() => useNativeBackIntercept(lower));
    const top = renderHook(() => useNativeBackIntercept(upper));
    runNativeBackIntercept();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    top.unmount();
    runNativeBackIntercept();
    expect(lower).toHaveBeenCalledTimes(1);
  });
});

describe('useNativeLeaveGuard', () => {
  it('no guard → the caller navigates itself', () => {
    const leave = vi.fn();
    expect(runNativeLeaveGuard(leave)).toBe(false);
    expect(leave).not.toHaveBeenCalled();
  });

  it('an active guard receives `leave` and decides when to call it', () => {
    let held: (() => void) | null = null;
    const { rerender, unmount } = renderHook(({ on }: { on: boolean }) =>
      useNativeLeaveGuard(on ? (go) => { held = go; } : null), { initialProps: { on: true } });
    const leave = vi.fn();
    expect(runNativeLeaveGuard(leave)).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    held!();
    expect(leave).toHaveBeenCalledTimes(1);
    rerender({ on: false });
    expect(runNativeLeaveGuard(vi.fn())).toBe(false);
    unmount();
  });

  it('is separate from the intercept stack: a guard never swallows a plain back', () => {
    renderHook(() => useNativeLeaveGuard(() => undefined));
    expect(runNativeBackIntercept()).toBe(false);
  });
});
