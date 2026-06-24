// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePoHistoryNav } from './history-nav';

function pressBack(): void {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

afterEach(() => {
  window.history.replaceState(null, '');
  vi.restoreAllMocks();
});

describe('usePoHistoryNav (full-history bridge)', () => {
  it('recordNavigate adds a same-URL history entry tagged poNav', () => {
    const { result } = renderHook(() => usePoHistoryNav({ enabled: true, onBack: () => {} }));
    const pushSpy = vi.spyOn(window.history, 'pushState');

    act(() => result.current.recordNavigate());
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect((window.history.state as { poNav?: boolean } | null)?.poNav).toBe(true);
  });

  it('a real back (popstate) calls onBack to restore the previous position', () => {
    const onBack = vi.fn();
    renderHook(() => usePoHistoryNav({ enabled: true, onBack }));
    pressBack();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('goBack drives history.back so the chevron shares the popstate path', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { result } = renderHook(() => usePoHistoryNav({ enabled: true, onBack: () => {} }));

    act(() => result.current.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('does not listen while disabled', () => {
    const onBack = vi.fn();
    renderHook(() => usePoHistoryNav({ enabled: false, onBack }));
    pressBack();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('always calls the latest onBack without rebinding the listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePoHistoryNav({ enabled: true, onBack: cb }), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    pressBack();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
