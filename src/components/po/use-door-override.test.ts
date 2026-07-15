// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDoorOverride, type DoorOverrideState } from './use-door-override';

const OVERLAY: DoorOverrideState = { seg: 'deur', eventId: 'A', overlay: { kind: 'guest', id: 'g1' } };
const LIST: DoorOverrideState = { seg: 'deur', eventId: 'A', overlay: null };

describe('useDoorOverride', () => {
  it('starts null (the URL is authoritative until something shadows it)', () => {
    const { result } = renderHook(() => useDoorOverride('/app/door', 'event=A'));
    expect(result.current[0]).toBeNull();
  });

  it('keeps the shadow across renders whose URL deps did not change (raw-history sub-nav)', () => {
    // Next does not track raw pushState/replaceState, so pathname/searchParams
    // stay frozen while door sub-nav shadows the state — the override must survive.
    const { result, rerender } = renderHook(({ p, s }) => useDoorOverride(p, s), {
      initialProps: { p: '/app/door', s: 'event=A' },
    });
    act(() => result.current[1](OVERLAY));
    expect(result.current[0]).toEqual(OVERLAY);
    rerender({ p: '/app/door', s: 'event=A' }); // same deps → not cleared
    expect(result.current[0]).toEqual(OVERLAY);
  });

  it('drops the shadow when Next reports a real navigation (deps change)', () => {
    const { result, rerender } = renderHook(({ p, s }) => useDoorOverride(p, s), {
      initialProps: { p: '/app/door', s: 'event=A' },
    });
    act(() => result.current[1](OVERLAY));
    rerender({ p: '/app/door', s: 'event=B' }); // searchParams changed
    expect(result.current[0]).toBeNull();
  });

  // Regression for 86ey9tq62: the door is entered via `?event=A`, freezing
  // useSearchParams at `event=A`; raw switch/re-pick/overlay sub-nav never
  // changes it; popping the overlay returns to `?event=A` — the SAME frozen
  // string. The deps-effect never re-runs, so before the fix the stale overlay
  // override survived the pop (overlay lingers, next Back over-pops past the
  // check-in list). A popstate must clear the shadow even with unchanged deps.
  it('drops the shadow on a browser back/forward even when the URL deps are unchanged', () => {
    const { result, rerender } = renderHook(({ p, s }) => useDoorOverride(p, s), {
      initialProps: { p: '/app/door', s: 'event=A' },
    });
    act(() => result.current[1](OVERLAY));
    expect(result.current[0]).toEqual(OVERLAY);

    // Back pressed → browser fires popstate; Next's frozen deps are identical.
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    rerender({ p: '/app/door', s: 'event=A' }); // deps genuinely unchanged
    expect(result.current[0]).toBeNull();
  });

  it('removes its popstate listener on unmount (no stale updates)', () => {
    const { result, unmount } = renderHook(() => useDoorOverride('/app/door', 'event=A'));
    act(() => result.current[1](LIST));
    unmount();
    // Firing popstate after unmount must not throw (listener detached).
    expect(() => window.dispatchEvent(new PopStateEvent('popstate'))).not.toThrow();
  });
});
