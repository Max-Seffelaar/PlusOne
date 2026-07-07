// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DoorView } from '../model';
import type { DoorGuest } from '../model';

// ── Mock the door context so we can feed a 1500-guest view without a provider ──
// listFilters/setListFilters mirror the provider contract with a real useState
// (called inside the component render, so hook rules hold) — typing in the
// search box must still re-render the list.
const view: { current: DoorView | null } = { current: null };
vi.mock('../DoorProvider', async () => {
  const { useState } = await import('react');
  return {
    useDoor: () => {
      const [listFilters, setFilters] = useState({ q: '', f: 'both' as const, tierIds: new Set<string>() });
      return {
        view: view.current,
        outboxByGuest: new Map(),
        undoRefusal: vi.fn(),
        listFilters,
        setListFilters: (patch: Partial<typeof listFilters>) => setFilters((prev) => ({ ...prev, ...patch })),
      };
    },
  };
});

// Import AFTER the mock so the component picks up the mocked useDoor.
import { CheckInList } from './CheckInList';

function dg(i: number): DoorGuest {
  return {
    id: `g${i}`,
    name: `Gast Nummer ${i}`,
    plus: 0,
    tierId: 't1',
    tierName: 'Gast',
    tierColor: '#fff',
    tierIcon: 'user',
    addedByName: 'Manager',
    addedAt: '1 jan',
    last4: null,
    note: null,
    notePriority: 'none',
    acknowledged: false,
    inside: false,
    voided: false,
    pay: false,
    arrived: undefined,
    refused: false,
    refusedReason: undefined,
  };
}

function makeView(n: number): DoorView {
  const guests = Array.from({ length: n }, (_, i) => dg(i));
  return {
    event: { name: 'Testavond', venueName: 'De Loods' } as DoorView['event'],
    guests,
    refused: [],
    tiers: [],
    insideCount: 0,
    waitingCount: n,
    insideHeadcount: 0,
    waitingHeadcount: n,
  };
}

// ── jsdom has no layout: stub offsetHeight/Width so the virtualizer has a viewport.
// virtual-core reads `offsetHeight` (getRect + measureElement). The scroll parent
// (no data-index) reports a 600px viewport; measured rows report a fixed height so
// only a window of them mounts.
let offH: PropertyDescriptor | undefined;
let offW: PropertyDescriptor | undefined;
beforeAll(() => {
  offH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  offW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-index') ? 86 : 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return 400;
    },
  });
  // virtual-core uses ResizeObserver to track size; a no-op is enough because the
  // initial synchronous measure already reads offsetHeight.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});
afterAll(() => {
  if (offH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offH);
  if (offW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offW);
  vi.unstubAllGlobals();
});

describe('CheckInList virtualization @1500', () => {
  it('mounts far fewer than 1500 guest rows', () => {
    view.current = makeView(1500);
    render(<CheckInList onOpenGuest={vi.fn()} onAdd={vi.fn()} />);

    // The "onderweg" stat tile still reflects the full count…
    expect(screen.getByText('1500')).toBeInTheDocument();
    // …but only a windowed subset of rows is in the DOM.
    const rows = screen.getAllByText(/^Gast Nummer \d+$/);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
  });

  it('typing a query still surfaces a matching guest', async () => {
    view.current = makeView(1500);
    render(<CheckInList onOpenGuest={vi.fn()} onAdd={vi.fn()} />);

    const input = screen.getByPlaceholderText('Search a name…');
    // A guest deep in the list is NOT mounted initially…
    expect(screen.queryByText('Gast Nummer 1234')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Gast Nummer 1234' } });

    // Debounce is 140ms — wait for the filtered result to surface.
    const hit = await screen.findByText('Gast Nummer 1234', {}, { timeout: 1000 });
    expect(hit).toBeInTheDocument();
    // And the search count reflects the single match.
    expect(screen.getByText('1 found')).toBeInTheDocument();
  });

  it('renders the loading skeleton when the view is absent', () => {
    view.current = null;
    const { container } = render(<CheckInList onOpenGuest={vi.fn()} onAdd={vi.fn()} />);
    expect(within(container).getByText('Loading…')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});
