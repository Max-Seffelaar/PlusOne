// @vitest-environment jsdom
/**
 * The door inside the REAL shell (N6 review, decision 14 + #25): `DoorProvider`
 * mounts exactly once across every chrome flip at 1024px.
 *
 * `use-door-variant.test.tsx` renders `PoDoorBranch` on its own, which cannot
 * see a remount caused by the tree AROUND it. `ResponsiveShell` used to return
 * two different trees for the bottom-tab and sidebar chromes, so `children` —
 * the Deur tab — sat at a different element path in each, and every flip
 * (a UA-seeded first frame that `useViewport` corrects, an iPad rotated across
 * 1024 mid-shift, a laptop window widened past it) unmounted the door and its
 * outbox state and built a new one. It also reset the variant latch, which is
 * component state, so a widened laptop window swapped a live outbox for the
 * cockpit. These tests render the real shell wrapping the real branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type JSX, type ReactNode } from 'react';
import { act, render } from '@testing-library/react';

// ── controllable device: every media query and innerWidth derived from it ──
const device = { width: 1280, fine: true };
const listeners = new Set<() => void>();
function evaluate(query: string): boolean {
  if (query === '(pointer: fine)') return device.fine;
  if (query === '(pointer: coarse)') return !device.fine;
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return device.width <= Number(max[1]);
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return device.width >= Number(min[1]);
  return false;
}
function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        return evaluate(query);
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }),
  });
}
/** Rotate / resize / toggle touch: fire the media-query `change` AND `resize`
 *  (both `useViewport` and `useDoorVariant` listen to both). */
function setDevice(next: Partial<typeof device>): void {
  Object.assign(device, next);
  act(() => {
    listeners.forEach((l) => l());
    window.dispatchEvent(new Event('resize'));
  });
}

// ── door-branch dependencies: counters on the outbox provider's lifetime ──
const H = vi.hoisted(() => ({ providerMounts: 0, providerUnmounts: 0 }));

vi.mock('next/dynamic', () => ({
  default: () =>
    function CockpitStub(): JSX.Element {
      return <div data-testid="cockpit" />;
    },
}));
vi.mock('@/features/po/hooks', () => ({
  usePoDoorCandidates: () => ({
    data: [{ id: 'ev-a', name: 'Friday' }],
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    refetch: () => Promise.resolve(),
  }),
}));
vi.mock('@/features/po/door-event', () => ({ autoOpenDoorEvent: () => null }));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));
vi.mock('@/features/door/DoorQueryProvider', () => ({
  DoorQueryProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/door/DoorProvider', () => ({
  DoorProvider: ({ children }: { children?: ReactNode }) => {
    useEffect(() => {
      H.providerMounts += 1;
      return () => {
        H.providerUnmounts += 1;
      };
    }, []);
    return <div data-testid="door-provider">{children}</div>;
  },
}));
vi.mock('@/components/po/screens/door', () => ({
  PoDoorTab: () => <div data-testid="door-tab" />,
  DoorEventPicker: () => <div data-testid="door-picker" />,
}));

const { ResponsiveShell } = await import('./shell-responsive');
const { PoDoorBranch } = await import('./door-branch');

const noop = (): void => {};
const doorNav = {
  onTab: noop,
  openGuest: noop,
  openAdd: noop,
  closeOverlay: noop,
  onChangeEvent: noop,
  onPickEvent: noop,
  pinEvent: noop,
};

/** The Deur tab as `/app` composes it: the real shell around the real branch.
 *  `serverHint` is the UA seed `useViewport` starts from (isMobileUA). */
function renderDoorInShell(serverHint: boolean) {
  return render(
    <ResponsiveShell
      serverHint={serverHint}
      isTabRoot
      mobileTab="deur"
      setMobileTab={noop}
      navItems={[]}
      venueName="Club"
      onOpenVenue={noop}
      onOpenProfile={noop}
      userName="Door"
      userSub="Doorhost"
    >
      <PoDoorBranch
        doorState={{ seg: 'deur', eventId: 'ev-a', overlay: null }}
        doorEventIdFromUrl="ev-a"
        doorNav={doorNav}
        onChooseCockpitEvent={noop}
      />
    </ResponsiveShell>,
  );
}

type View = ReturnType<typeof renderDoorInShell>;
const hasSidebar = (v: View): boolean => v.container.querySelector('aside') !== null;
function expectOutboxMountedOnce(v: View): void {
  expect(v.queryByTestId('door-provider')).not.toBeNull();
  expect(v.queryByTestId('cockpit')).toBeNull();
  expect(H.providerMounts).toBe(1);
  expect(H.providerUnmounts).toBe(0);
}

beforeEach(() => {
  Object.assign(device, { width: 1280, fine: true });
  listeners.clear();
  installMatchMedia();
  H.providerMounts = 0;
  H.providerUnmounts = 0;
});

describe('first load — the UA-seeded chrome is corrected without remounting the door', () => {
  it('iPad portrait 768px, touch, correct mobile UA seed → exactly 1 mount', () => {
    Object.assign(device, { width: 768, fine: false });
    const view = renderDoorInShell(true);
    expect(hasSidebar(view)).toBe(false);
    expectOutboxMountedOnce(view);
  });

  it('iPad portrait 768px, touch, iPadOS "Macintosh" UA (seed says desktop) → exactly 1 mount', () => {
    Object.assign(device, { width: 768, fine: false });
    const view = renderDoorInShell(false);
    expect(hasSidebar(view)).toBe(false); // the chrome DID flip to bottom tabs
    expectOutboxMountedOnce(view);
  });

  it('iPad Air portrait 820px, touch, "Macintosh" UA → exactly 1 mount', () => {
    Object.assign(device, { width: 820, fine: false });
    const view = renderDoorInShell(false);
    expect(hasSidebar(view)).toBe(false);
    expectOutboxMountedOnce(view);
  });

  it('narrow laptop window 800px, mouse, desktop UA → exactly 1 mount', () => {
    Object.assign(device, { width: 800, fine: true });
    const view = renderDoorInShell(false);
    expect(hasSidebar(view)).toBe(false);
    expectOutboxMountedOnce(view);
  });

  it('Android tablet landscape 1280px, touch, mobile UA (seed says bottom tabs) → exactly 1 mount', () => {
    Object.assign(device, { width: 1280, fine: false });
    const view = renderDoorInShell(true);
    expect(hasSidebar(view)).toBe(true); // flipped to the sidebar
    expectOutboxMountedOnce(view);
  });

  it('touch at exactly 1024px (iPad Pro portrait) → sidebar chrome AND the outbox, 1 mount', () => {
    Object.assign(device, { width: 1024, fine: false });
    const view = renderDoorInShell(false);
    expect(hasSidebar(view)).toBe(true);
    expectOutboxMountedOnce(view);
  });
});

describe('mid-shift chrome flips never remount DoorProvider', () => {
  it('rotating an iPad across 1024px both ways (820 → 1180 → 820 → 1180)', () => {
    Object.assign(device, { width: 820, fine: false });
    const view = renderDoorInShell(true);
    expectOutboxMountedOnce(view);

    setDevice({ width: 1180 });
    expect(hasSidebar(view)).toBe(true);
    expectOutboxMountedOnce(view);

    setDevice({ width: 820 });
    expect(hasSidebar(view)).toBe(false);
    expectOutboxMountedOnce(view);

    setDevice({ width: 1180 });
    expect(hasSidebar(view)).toBe(true);
    expectOutboxMountedOnce(view);
  });

  it('widening a laptop window (mouse) from 900px past 1024px keeps the live outbox — no cockpit swap', () => {
    Object.assign(device, { width: 900, fine: true });
    const view = renderDoorInShell(false);
    expectOutboxMountedOnce(view);

    setDevice({ width: 1400 });
    expect(hasSidebar(view)).toBe(true);
    expectOutboxMountedOnce(view); // latched: the cockpit never replaces a mounted outbox

    setDevice({ width: 900 });
    expectOutboxMountedOnce(view);
    setDevice({ width: 1600 });
    expectOutboxMountedOnce(view);
  });

  it('narrowing a laptop window from the cockpit below 1024px switches to the outbox (the safe direction), then latches', () => {
    const view = renderDoorInShell(false);
    expect(view.queryByTestId('cockpit')).not.toBeNull();
    expect(H.providerMounts).toBe(0);

    setDevice({ width: 800 });
    expect(hasSidebar(view)).toBe(false);
    expectOutboxMountedOnce(view);

    setDevice({ width: 1400 });
    expectOutboxMountedOnce(view);
  });

  it('leaving the Deur tab resets the latch: a wide mouse window gets the cockpit on return', () => {
    Object.assign(device, { width: 900, fine: true });
    const view = renderDoorInShell(false);
    setDevice({ width: 1400 });
    expectOutboxMountedOnce(view);
    view.unmount(); // the user taps another tab
    expect(H.providerUnmounts).toBe(1);

    const again = renderDoorInShell(false);
    expect(again.queryByTestId('cockpit')).not.toBeNull();
    expect(H.providerMounts).toBe(1);
  });
});
