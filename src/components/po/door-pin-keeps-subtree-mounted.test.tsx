// @vitest-environment jsdom
/**
 * The door subtree must survive the candidate list GROWING mid-shift (86eykm7qp).
 *
 * `app.tsx` derives the door's event as
 * `doorState.eventId ?? (doorCandidates.length === 1 ? doorCandidates[0].id : null)`.
 * That implicit single-candidate choice used to be re-derived on every render and
 * never written back, so the instant a SECOND event went live — React Query's
 * `refetchOnReconnect` default refetches the candidate list after any wifi hiccup,
 * and `PoLiveProvider` doesn't turn it off — `requestedDoorId` flipped to `null`,
 * `<DoorEventPicker>` replaced `<DoorQueryProvider><DoorProvider>` at the same
 * position, and React unmounted the whole door tree. `useDoorSync`'s cleanup then
 * ran `removeChannel`, so a doorhost lost realtime + sync mid-check-in and landed
 * on an unexplained event picker.
 *
 * This drives the REAL `PlusOneApp` (only the periphery is stubbed) and asserts on
 * the door subtree's mount identity, because that is exactly what decides whether
 * the realtime channel is torn down. `DoorProvider` is stubbed with a probe that
 * opens a channel on mount and closes it on unmount, mirroring `useDoorSync`'s own
 * `client.removeChannel(channel)` cleanup — so "channel torn down" and "provider
 * remounted" are asserted in the bug's own terms.
 *
 * Regression note (PR #261, round 1): the previous attempt at covering this
 * re-implemented the wiring in a local harness and never imported `app.tsx`, so it
 * stayed green with the fix reverted. Hence: real component, real branch logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShellDataProvider } from './app-shell-data';

const EVENT_A = 'ev-a';
const EVENT_B = 'ev-b';

/** Mutable wiring the hoisted mock factories read lazily. */
const H = vi.hoisted(() => ({
  candidates: [] as { id: string; name: string }[],
  isFetching: false,
  refetchCalls: 0,
  doorMounts: 0,
  doorUnmounts: 0,
  channelTeardowns: 0,
  openChannels: [] as string[],
  pickerMounts: 0,
}));

// ── periphery stubs ─────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/door',
  // The door's sub-nav goes through the raw History API, which Next's hooks
  // deliberately do NOT track — they stay frozen at the last router navigation.
  // A constant here models that exactly.
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = (): null => null;
    return Stub;
  },
}));
vi.mock('@/lib/observability/sentry-client', () => ({
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
}));
vi.mock('@/features/venues/actions', () => ({ setActiveVenueAction: vi.fn() }));
vi.mock('@/features/po/door-event', () => ({ autoOpenDoorEvent: () => null }));
vi.mock('./use-viewport', () => ({ useViewport: () => true })); // mobile → the door branch under test

vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u-door', venueId: 'v1', roles: ['doorhost'] }),
}));

vi.mock('@/features/po/hooks', () => ({
  // `refetch` flips `isFetching`, exactly like the real query — and `isFetching`
  // is in this query's `notifyOnChangeProps`, so it is the re-render signal the
  // stale-id rejection waits on before it is treated as settled. A no-op stub
  // here would model a retry that never lands.
  usePoDoorCandidates: () => ({
    data: H.candidates,
    isLoading: false,
    isFetching: H.isFetching,
    isSuccess: true,
    refetch: () => {
      H.refetchCalls += 1;
      return Promise.resolve();
    },
  }),
  usePoEvents: () => ({ data: [] }),
  usePoGuestRequests: () => ({ data: [] }),
  usePoCanManageTemplates: () => false,
  usePoIsDoorOrganizer: () => false,
}));

// The two probes. `DoorProvider` models useDoorSync's channel lifecycle so the
// assertion below reads in the bug's own terms; `DoorEventPicker` records that
// the host was bounced to the picker at all.
vi.mock('@/features/door/DoorProvider', async () => {
  const { useEffect } = await import('react');
  return {
    DoorProvider: ({ eventId, children }: { eventId: string; children?: unknown }) => {
      useEffect(() => {
        H.doorMounts += 1;
        const channel = `door:${eventId}`;
        H.openChannels.push(channel);
        return () => {
          H.doorUnmounts += 1;
          H.channelTeardowns += 1;
          H.openChannels = H.openChannels.filter((c) => c !== channel);
        };
      }, [eventId]);
      return <div data-testid="door-provider">{children as never}</div>;
    },
  };
});
vi.mock('@/features/door/DoorQueryProvider', () => ({
  DoorQueryProvider: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));

vi.mock('./screens/door', async () => {
  const { useEffect } = await import('react');
  return {
    PoDoorTab: () => <div data-testid="door-tab" />,
    DoorEventPicker: () => {
      useEffect(() => {
        H.pickerMounts += 1;
      }, []);
      return <div data-testid="door-picker" />;
    },
  };
});

// Screen modules: never reached on the door tab, but imported at module load.
vi.mock('./screens/events', () => ({
  Crew: () => null,
  EventEdit: () => null,
  EventView: () => null,
  Events: () => null,
  PastEvent: () => null,
  Tiers: () => null,
}));
vi.mock('./screens/guests', () => ({
  BulkPaste: () => null,
  Contacten: () => null,
  ContactProfile: () => null,
  GuestsTab: () => null,
}));
vi.mock('./screens/settings', () => ({
  Allowance: () => null,
  Billing: () => null,
  Gebruikers: () => null,
  Import: () => null,
  Meer: () => null,
  Profile: () => null,
  Rollen: () => null,
  VenueSettings: () => null,
  VenueSwitch: () => null,
}));
vi.mock('./screens/onboarding', () => ({ VenueCreate: () => null }));
vi.mock('./screens/home', () => ({ Home: () => null }));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));
vi.mock('./shell-responsive', () => ({
  ResponsiveShell: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));

const { PlusOneApp } = await import('./app');

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Built fresh on every call, never a hoisted constant: `rerender` with the SAME
 *  element object makes React bail out of re-rendering entirely, which would make
 *  this test pass for the wrong reason. */
const tree = () => (
  <QueryClientProvider client={client}>
    <AppShellDataProvider
      value={{ myVenues: [], activeVenueId: 'v1', serverHint: true, statsAccess: { venues: [] } }}
    >
      <PlusOneApp />
    </AppShellDataProvider>
  </QueryClientProvider>
);

describe('door subtree survives the candidate list growing (86eykm7qp)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/app/door');
    H.candidates = [{ id: EVENT_A, name: 'Vrijdag' }];
    H.isFetching = false;
    H.refetchCalls = 0;
    H.doorMounts = 0;
    H.doorUnmounts = 0;
    H.channelTeardowns = 0;
    H.openChannels = [];
    H.pickerMounts = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps DoorProvider mounted (and its realtime channel open) when a second event goes live', async () => {
    const view = render(tree());

    // Exactly one live event and nothing explicitly picked → the door mounts on it.
    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(H.doorMounts).toBe(1);
    expect(H.openChannels).toEqual([`door:${EVENT_A}`]);

    // The wifi hiccups and comes back; `refetchOnReconnect` refires the candidate
    // query and a colleague has meanwhile put the next party live.
    await act(async () => {
      H.candidates = [
        { id: EVENT_A, name: 'Vrijdag' },
        { id: EVENT_B, name: 'Zaterdag' },
      ];
      view.rerender(tree());
    });

    // The doorhost is mid-check-in: the door must still be there, on the SAME
    // event, with its realtime channel never torn down.
    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(view.queryByTestId('door-picker')).toBeNull();
    expect(H.pickerMounts).toBe(0);
    expect(H.channelTeardowns).toBe(0);
    expect(H.doorUnmounts).toBe(0);
    expect(H.doorMounts).toBe(1); // still the original mount — not a remount
    expect(H.openChannels).toEqual([`door:${EVENT_A}`]);
  });

  it('pins the implicit choice into the door URL so a reload/back cannot re-derive it away', async () => {
    const view = render(tree());
    expect(H.doorMounts).toBe(1);

    // The single-candidate pick must be written back, not left implicit — that
    // write-back is what makes the assertion above hold. `replaceDoorState` puts
    // it on raw history (no router round-trip → door offline invariant #25).
    expect(window.location.search).toContain(`event=${EVENT_A}`);
    view.unmount();
  });

  it('releases the pin when the pinned event ends, so the host is not stranded', async () => {
    const view = render(tree());
    expect(H.doorMounts).toBe(1);
    expect(window.location.search).toContain(`event=${EVENT_A}`);

    // Vrijdag closes and Zaterdag is now the only candidate. A pin must not
    // outlive its event: the "ander event" control only appears with >1
    // candidates, so a stuck pin would leave the host on the empty state with no
    // way back. The door follows to the new single event.
    await act(async () => {
      H.candidates = [{ id: EVENT_B, name: 'Zaterdag' }];
      view.rerender(tree());
    });
    // The list rejecting an id is not enough on its own — it gets one refetch
    // first, in case the list is merely stale. Drive that retry to its settle.
    await act(async () => {
      H.isFetching = true;
      view.rerender(tree());
    });
    await act(async () => {
      H.isFetching = false;
      view.rerender(tree());
    });
    await act(async () => {
      view.rerender(tree());
    });

    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(H.openChannels).toEqual([`door:${EVENT_B}`]);
    expect(window.location.search).toContain(`event=${EVENT_B}`);
    view.unmount();
  });
});
