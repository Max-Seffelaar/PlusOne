// @vitest-environment jsdom
/**
 * Door-variant selection (capacitor-plan decision 14, N6): the offline-outbox
 * door for a coarse pointer OR <1024px; the online-only cockpit only for a fine
 * pointer at ≥1024px — and a mounted outbox (`DoorProvider`) is never torn
 * down by a later pointer/width change.
 *
 * Covers the hook itself, the real `PoDoorBranch` (what `/app`'s Deur tab
 * mounts) and the real `DoorRoute` (standalone `/door/[id]`, SSR'd).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type JSX, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, render, renderHook } from '@testing-library/react';

// ── controllable matchMedia: one device state, every query derived from it ──
const device = { width: 1280, fine: true };
const listeners = new Set<() => void>();
function evaluate(query: string): boolean {
  if (query === '(pointer: fine)') return device.fine;
  if (query === '(pointer: coarse)') return !device.fine;
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return device.width <= Number(max[1]);
  return false;
}
function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return evaluate(query);
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }),
  });
}
function setDevice(next: Partial<typeof device>): void {
  Object.assign(device, next);
  act(() => listeners.forEach((l) => l()));
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

const { useDoorVariant, useLatchedDoorVariant } = await import('./use-door-variant');
const { PoDoorBranch } = await import('./door-branch');
const { DoorRoute } = await import('@/features/door/components/DoorRoute');

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
const branch = (
  <PoDoorBranch
    doorState={{ seg: 'deur', eventId: 'ev-a', overlay: null }}
    doorEventIdFromUrl="ev-a"
    doorNav={doorNav}
    onChooseCockpitEvent={noop}
  />
);

beforeEach(() => {
  Object.assign(device, { width: 1280, fine: true });
  listeners.clear();
  installMatchMedia();
  H.providerMounts = 0;
  H.providerUnmounts = 0;
});

// {fine, coarse} × {<1024, ≥1024} — decision 14's whole truth table.
const MATRIX = [
  { name: 'laptop — fine pointer, 1280px', width: 1280, fine: true, variant: 'cockpit' },
  { name: 'laptop window at exactly 1024px, fine pointer', width: 1024, fine: true, variant: 'cockpit' },
  { name: 'narrow desktop window — fine pointer, 800px', width: 800, fine: true, variant: 'outbox' },
  { name: 'iPad landscape — coarse pointer, 1366px', width: 1366, fine: false, variant: 'outbox' },
  { name: 'iPad portrait — coarse pointer, 768px', width: 768, fine: false, variant: 'outbox' },
  { name: 'phone — coarse pointer, 390px', width: 390, fine: false, variant: 'outbox' },
] as const;

describe('useDoorVariant — decision 14 matrix', () => {
  it.each(MATRIX)('$name → $variant', ({ width, fine, variant }) => {
    Object.assign(device, { width, fine });
    const { result } = renderHook(() => useDoorVariant());
    expect(result.current).toBe(variant);
  });

  it('no matchMedia (old webview, #37) → outbox, even at desktop width', () => {
    Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: undefined });
    const { result } = renderHook(() => useDoorVariant());
    expect(result.current).toBe('outbox');
  });

  it('follows a live media change', () => {
    const { result } = renderHook(() => useDoorVariant());
    expect(result.current).toBe('cockpit');
    setDevice({ fine: false });
    expect(result.current).toBe('outbox');
    setDevice({ fine: true });
    expect(result.current).toBe('cockpit');
  });
});

describe('useLatchedDoorVariant', () => {
  it('once outbox, stays outbox through a pointer AND a width change', () => {
    Object.assign(device, { width: 1366, fine: false });
    const { result } = renderHook(() => useLatchedDoorVariant());
    expect(result.current).toBe('outbox');
    setDevice({ fine: true }); // trackpad attached / DevTools touch off
    expect(result.current).toBe('outbox');
    setDevice({ width: 1600 });
    expect(result.current).toBe('outbox');
  });

  it('cockpit → outbox still switches live (that only mounts a DoorProvider)', () => {
    const { result } = renderHook(() => useLatchedDoorVariant());
    expect(result.current).toBe('cockpit');
    setDevice({ width: 900 });
    expect(result.current).toBe('outbox');
    setDevice({ width: 1280 });
    expect(result.current).toBe('outbox');
  });
});

describe('PoDoorBranch (the /app Deur tab)', () => {
  it.each(MATRIX)('$name → mounts the $variant variant on the FIRST render', ({ width, fine, variant }) => {
    Object.assign(device, { width, fine });
    const view = render(branch);
    if (variant === 'outbox') {
      expect(view.queryByTestId('door-provider')).not.toBeNull();
      expect(view.queryByTestId('cockpit')).toBeNull();
    } else {
      expect(view.queryByTestId('cockpit')).not.toBeNull();
      expect(view.queryByTestId('door-provider')).toBeNull();
    }
    // Never a provisional variant first: exactly one provider mount, or none.
    expect(H.providerMounts).toBe(variant === 'outbox' ? 1 : 0);
    expect(H.providerUnmounts).toBe(0);
  });

  it('a pointer change after mount does not remount DoorProvider (iPad landscape, touch toggled off)', () => {
    Object.assign(device, { width: 1366, fine: false });
    const view = render(branch);
    expect(H.providerMounts).toBe(1);

    setDevice({ fine: true }); // now reads as a laptop: fine pointer, ≥1024px
    setDevice({ fine: false });
    setDevice({ fine: true });

    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(view.queryByTestId('cockpit')).toBeNull();
    expect(H.providerMounts).toBe(1);
    expect(H.providerUnmounts).toBe(0);
  });

  it('a resize across 1024px after mount does not remount DoorProvider either', () => {
    Object.assign(device, { width: 900, fine: true });
    render(branch);
    setDevice({ width: 1400 });
    expect(H.providerMounts).toBe(1);
    expect(H.providerUnmounts).toBe(0);
  });

  it('leaving the door tab and coming back re-evaluates (latch is per mount)', () => {
    Object.assign(device, { width: 1366, fine: false });
    const view = render(branch);
    setDevice({ fine: true });
    view.unmount(); // user taps another tab
    const again = render(branch);
    expect(again.queryByTestId('cockpit')).not.toBeNull();
  });
});

describe('DoorRoute (standalone /door/[id], SSR)', () => {
  const replace = vi.fn();
  const originalLocation = window.location;
  beforeEach(() => {
    replace.mockClear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, replace },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('server HTML is the neutral placeholder — no DoorProvider built on a server-side guess', () => {
    const html = renderToString(<DoorRoute eventId="ev-a" />);
    expect(html).not.toContain('door-provider');
    expect(H.providerMounts).toBe(0);
  });

  it('iPad landscape (touch, 1366px) keeps the outbox door and never redirects', () => {
    Object.assign(device, { width: 1366, fine: false });
    const view = render(<DoorRoute eventId="ev-a" />);
    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('laptop (fine pointer, 1280px) redirects to the /app cockpit without mounting the outbox', () => {
    render(<DoorRoute eventId="ev-a" />);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toContain('ev-a');
    expect(H.providerMounts).toBe(0);
  });

  it('a pointer change after mount neither remounts the outbox nor redirects it away', () => {
    Object.assign(device, { width: 1366, fine: false });
    render(<DoorRoute eventId="ev-a" />);
    setDevice({ fine: true });
    expect(replace).not.toHaveBeenCalled();
    expect(H.providerMounts).toBe(1);
    expect(H.providerUnmounts).toBe(0);
  });
});
