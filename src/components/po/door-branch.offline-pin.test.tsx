// @vitest-environment jsdom
/**
 * N7 (decision 15): the Deur tab mounts the last pinned door event when its
 * candidate list cannot load (offline cold start), and NEVER over a loaded list.
 * Rendered through the real `PoDoorBranch`/`MobileDoorBranch` with the real
 * `offlineDoorPin` rule; only the query, the IDB reads and the heavy door
 * providers are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { LastDoorEvent } from '@/features/door/offline/last-door';

const H = vi.hoisted(() => ({
  query: {
    data: [] as { id: string; name: string }[],
    isLoading: false,
    isFetching: false,
    isSuccess: false,
    isError: false,
    fetchStatus: 'paused' as 'paused' | 'idle' | 'fetching',
  },
  refetch: vi.fn(() => Promise.resolve()),
  pin: null as LastDoorEvent | null,
  load: vi.fn(),
  save: vi.fn(() => Promise.resolve(true)),
  seed: vi.fn(() => Promise.resolve()),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/lib/observability/sentry-client', () => ({ captureMessage: vi.fn() }));
vi.mock('./use-door-variant', () => ({ useLatchedDoorVariant: () => 'outbox' }));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u-door', venueId: 'v1', roles: ['doorhost'] }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoDoorCandidates: () => ({ ...H.query, refetch: H.refetch }),
}));
vi.mock('@/features/door/offline/last-door', async () => {
  const actual = await vi.importActual<typeof import('@/features/door/offline/last-door')>(
    '@/features/door/offline/last-door',
  );
  return {
    ...actual,
    loadLastDoorEvent: () => {
      H.load();
      return Promise.resolve(H.pin);
    },
    saveLastDoorEvent: H.save,
  };
});
vi.mock('@/components/register-sw', () => ({ seedLoadedAssets: H.seed }));
vi.mock('@/features/door/DoorProvider', () => ({
  DoorProvider: ({ eventId, children }: { eventId: string; children?: unknown }) => (
    <div data-testid="door-provider" data-event={eventId}>
      {children as never}
    </div>
  ),
}));
vi.mock('@/features/door/DoorQueryProvider', () => ({
  DoorQueryProvider: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));
vi.mock('./screens/door', () => ({
  PoDoorTab: () => <div data-testid="door-tab" />,
  DoorEventPicker: () => <div data-testid="door-picker" />,
}));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));

const { PoDoorBranch } = await import('./door-branch');
const { t } = await import('@/lib/i18n');

const PIN: LastDoorEvent = { venueId: 'v1', eventId: 'ev-pinned', name: 'Friday' };

function renderDoor(eventId: string | null = null) {
  const pinEvent = vi.fn();
  const doorNav = {
    onTab: vi.fn(),
    openGuest: vi.fn(),
    openAdd: vi.fn(),
    closeOverlay: vi.fn(),
    onChangeEvent: vi.fn(),
    onPickEvent: vi.fn(),
    pinEvent,
  };
  const view = render(
    <PoDoorBranch
      doorState={{ seg: 'deur', eventId, overlay: null }}
      doorEventIdFromUrl={eventId}
      doorNav={doorNav}
      onChooseCockpitEvent={vi.fn()}
    />,
  );
  return { view, pinEvent };
}

const mountedEvent = (): string | null =>
  screen.queryByTestId('door-provider')?.getAttribute('data-event') ?? null;

/** Let the lazy IndexedDB read resolve and its render commit. */
const settle = () => act(async () => {});

describe('MobileDoorBranch — offline pin (N7)', () => {
  beforeEach(() => {
    H.query = { data: [], isLoading: false, isFetching: false, isSuccess: false, isError: false, fetchStatus: 'paused' };
    H.pin = PIN;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offline cold start: mounts the pinned event from IndexedDB and writes it into the URL', async () => {
    const { pinEvent } = renderDoor();
    await settle();
    expect(mountedEvent()).toBe('ev-pinned');
    expect(pinEvent).toHaveBeenCalledWith('ev-pinned');
  });

  it('also mounts it when the candidate read failed (online-but-unreachable, errored query)', async () => {
    H.query = { ...H.query, isError: true, fetchStatus: 'idle' };
    renderDoor();
    await settle();
    expect(mountedEvent()).toBe('ev-pinned');
  });

  it('mounts it on a cold boot while the read is still "fetching" but the browser says offline', async () => {
    // React Query v5 starts assuming online, so offline the read does not
    // pause — it hangs in `fetching`. `navigator.onLine === false` is trusted.
    H.query = { ...H.query, isLoading: true, isFetching: true, fetchStatus: 'fetching' };
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      renderDoor();
      await settle();
      expect(mountedEvent()).toBe('ev-pinned');
    } finally {
      onLine.mockRestore();
    }
  });

  it('does NOT use the pin while an online read is still loading', async () => {
    H.query = { ...H.query, isLoading: true, isFetching: true, fetchStatus: 'fetching' };
    renderDoor();
    await settle();
    expect(mountedEvent()).toBeNull();
    expect(H.load).not.toHaveBeenCalled();
    expect(screen.getByText(t.common.loading)).toBeTruthy();
  });

  it('keeps the pinned event for an explicit ?event= that matches it, and never rejects it offline', async () => {
    const { pinEvent } = renderDoor('ev-pinned');
    await settle();
    expect(mountedEvent()).toBe('ev-pinned');
    // No "stale id" verdict from a list that never loaded: no refetch, no unpin.
    expect(H.refetch).not.toHaveBeenCalled();
    expect(pinEvent).not.toHaveBeenCalledWith(null);
  });

  it('never mounts the pin over a LOADED list — the list wins', async () => {
    H.query = { ...H.query, isSuccess: true, fetchStatus: 'idle', data: [{ id: 'ev-live', name: 'Saturday' }] };
    renderDoor();
    await settle();
    expect(mountedEvent()).toBe('ev-live');
    expect(H.load).not.toHaveBeenCalled();
  });

  it('never mounts the pin over a loaded EMPTY list (event closed since) — "no event" instead', async () => {
    H.query = { ...H.query, isSuccess: true, fetchStatus: 'idle', data: [] };
    renderDoor();
    await settle();
    expect(mountedEvent()).toBeNull();
    expect(screen.getByText(t.door.noEvent)).toBeTruthy();
  });

  it('never mounts a pin from another venue', async () => {
    H.pin = { ...PIN, venueId: 'v-other' };
    renderDoor();
    await settle();
    expect(mountedEvent()).toBeNull();
    expect(screen.getByText(t.door.noEventOffline)).toBeTruthy();
  });

  it('never mounts the pin against an explicit ?event= for a different event', async () => {
    renderDoor('ev-someone-else');
    await settle();
    expect(mountedEvent()).toBeNull();
  });

  it('offline with no pin at all: says so, instead of "create an event"', async () => {
    H.pin = null;
    renderDoor();
    await settle();
    expect(mountedEvent()).toBeNull();
    expect(screen.getByText(t.door.noEventOffline)).toBeTruthy();
  });

  it('remembers the event once the loaded list confirms it, and re-seeds the build chunks', async () => {
    H.query = { ...H.query, isSuccess: true, fetchStatus: 'idle', data: [{ id: 'ev-live', name: 'Saturday' }] };
    renderDoor();
    await settle();
    expect(H.save).toHaveBeenCalledTimes(1);
    expect(H.save).toHaveBeenCalledWith({ venueId: 'v1', eventId: 'ev-live', name: 'Saturday' });
    expect(H.seed).toHaveBeenCalledTimes(1);
  });

  it('never remembers an id the list has not confirmed', async () => {
    renderDoor('ev-pinned'); // offline, mounted from the pin
    await settle();
    expect(H.save).not.toHaveBeenCalled();
  });
});
