// @vitest-environment jsdom
/**
 * Proves the invariant app.tsx's `doorTabElement` memo (86ey9e9vc review, fix
 * #3) exists for: constructing `<PoDoorTab>` inline made `DoorProvider`'s
 * `children` prop a NEW object every `PlusOneApp` render, so React's
 * element-identity bailout could never fire and PoDoorTab (and everything it
 * mounts — SyncBar, the virtualized CheckInList) re-rendered on every
 * unrelated PlusOneApp state change. `useDoor()` is called unconditionally at
 * the top of `PoDoorTab`'s body, so counting its invocations is exactly
 * "did PoDoorTab's function body run" — the same technique used to verify the
 * DoorFiltersContext split in DoorProvider.test.tsx.
 *
 * `PassThrough` below stands in for `DoorProvider`/`DoorQueryProvider`: like
 * them, it is a plain (non-memoized) component that only forwards `children`.
 * The bailout depends on THAT shape — a memoized element surviving through an
 * unmemoized pass-through — not on `PoDoorTab` itself being wrapped in
 * `React.memo` (it isn't, and this test doesn't require it to be).
 */
import { describe, it, expect, vi } from 'vitest';
import { useCallback, useMemo, useState, type ReactNode, type JSX } from 'react';
import { render, act } from '@testing-library/react';
import { PoDoorTab } from './door';
import type { DoorSeg } from '../routes';
import type { DoorOverlay } from './door';

let useDoorCalls = 0;
vi.mock('@/features/door/DoorProvider', () => ({
  useDoor: () => {
    useDoorCalls += 1;
    return { toast: null };
  },
  useDoorSyncStatus: () => ({
    status: 'ok',
    ageLabel: '',
    online: true,
    realtimeConnected: true,
    syncing: false,
    lastSyncAt: null,
    forceSync: () => {},
  }),
}));
vi.mock('@/features/door/sync/useStaleResumeGuard', () => ({
  useStaleResumeGuard: () => ({ phase: 'closed', offline: false, continueAnyway: () => {}, retry: () => {} }),
}));
vi.mock('@/features/door/components/CheckInList', () => ({ CheckInList: () => <div>checkin-list</div> }));
vi.mock('@/features/door/components/Taken', () => ({ Taken: () => <div>taken</div> }));
vi.mock('@/features/door/components/GuestDetail', () => ({ GuestDetail: () => <div>guest-detail</div> }));
vi.mock('@/features/door/components/AddOnSpot', () => ({ AddOnSpot: () => <div>add-on-spot</div> }));
vi.mock('@/features/door/components/SyncBar', () => ({ SyncBar: () => <div>sync-bar</div> }));
vi.mock('@/features/door/components/StaleResumeOverlay', () => ({ StaleResumeOverlay: () => null }));
vi.mock('@/features/door/components/DoorErrorBoundary', () => ({
  DoorErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function PassThrough({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}

// Mirrors app.tsx's actual wiring: stable useCallback handlers + a useMemo'd
// `<PoDoorTab>` element passed through an unmemoized wrapper. `overlay` is the
// one prop the test drives to prove the memo is real (not just always-stable).
function Harness({ tick, overlay }: { tick: number; overlay: DoorOverlay }): JSX.Element {
  const [seg] = useState<DoorSeg>('deur');
  const onTab = useCallback(() => {}, []);
  const openGuest = useCallback(() => {}, []);
  const openAdd = useCallback(() => {}, []);
  const closeOverlay = useCallback(() => {}, []);
  const element = useMemo(
    () => (
      <PoDoorTab tab={seg} onTab={onTab} overlay={overlay} openGuest={openGuest} openAdd={openAdd} closeOverlay={closeOverlay} />
    ),
    [seg, onTab, overlay, openGuest, openAdd, closeOverlay],
  );
  return (
    <div data-tick={tick}>
      <PassThrough>{element}</PassThrough>
    </div>
  );
}

describe('PoDoorTab render-scope bailout (86ey9e9vc review, fix #3)', () => {
  it('does not re-render when an unrelated ancestor re-renders (stable memoized element + stable callbacks)', () => {
    useDoorCalls = 0;
    const { rerender } = render(<Harness tick={0} overlay={null} />);
    const afterMount = useDoorCalls;
    expect(afterMount).toBeGreaterThan(0);

    act(() => {
      rerender(<Harness tick={1} overlay={null} />);
    });
    act(() => {
      rerender(<Harness tick={2} overlay={null} />);
    });

    expect(useDoorCalls).toBe(afterMount);
  });

  it('does re-render when a real memo dependency changes (overlay opens)', () => {
    useDoorCalls = 0;
    const { rerender } = render(<Harness tick={0} overlay={null} />);
    const afterMount = useDoorCalls;

    act(() => {
      rerender(<Harness tick={1} overlay={{ kind: 'add' }} />);
    });

    expect(useDoorCalls).toBeGreaterThan(afterMount);
  });
});
