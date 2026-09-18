// @vitest-environment jsdom
/**
 * Guest tiers screen, Joeri walkthrough (z8uq9m0hw3):
 * - item 4: "Add another tier" sits under the list (no header "+"); the empty
 *   state keeps its own CTA.
 * - item 5: a tier card opens the same form prefilled and saves through
 *   updateTier WITHOUT aliases; the tier's own colour is never blocked; a max
 *   below current use warns; only admin/organizer get the affordance.
 * - item 7: the guided setup step after creating an event.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';

const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: true };
const createTier = vi.fn().mockResolvedValue(undefined);
const updateTier = vi.fn().mockResolvedValue(undefined);

const GUEST = {
  id: 'tier-guest',
  name: 'Guest',
  short: 'Guest',
  role: 'Guest',
  color: '#B5A6FF',
  max: 150,
  used: 24,
  doorPrice: 10,
  vatPercent: 21,
  aliases: ['gl', 'guestlist'],
};
const VIP = {
  id: 'tier-vip',
  name: 'VIP',
  short: 'VIP',
  role: 'VIP',
  color: '#9DE0C0',
  max: 40,
  used: 11,
  doorPrice: 0,
  vatPercent: null,
  aliases: ['vip'],
};

let tiersData: unknown[] = [];
let canManage = true;

vi.mock('@/features/po/hooks', () => ({
  usePoEvent: () => ({ event: { id: 'evt-1', name: 'FRENZY' } }),
  usePoTiers: () => ({ data: tiersData, isLoading: false, isError: false }),
  usePoEventForEdit: () => ({ canManage, isLoading: false }),
}));

vi.mock('@/features/po/mutations', () => ({
  usePoCreateTier: () => ({ mutateAsync: createTier, isPending: false }),
  usePoUpdateTier: () => ({ mutateAsync: updateTier, isPending: false }),
}));

vi.mock('@/components/po/context', () => ({ useNav: () => nav }));

// Imported AFTER the mocks so the screen picks them up.
import { Tiers } from './tiers';

beforeEach(() => {
  tiersData = [GUEST, VIP];
  canManage = true;
  vi.clearAllMocks();
  createTier.mockResolvedValue(undefined);
  updateTier.mockResolvedValue(undefined);
});

afterEach(cleanup);

const colorBtn = (c: string): HTMLElement => screen.getByRole('button', { name: fmt(t.events.colorAria, { color: c }) });

describe('Add another tier (item 4)', () => {
  it('is a full-width button under the list and opens the create form', () => {
    render(<Tiers eventId="evt-1" />);

    const add = screen.getByRole('button', { name: t.events.addAnotherTier });
    expect(add).toHaveClass('w-full');
    // Below the last tier card in document order.
    const lastCard = screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'VIP' }) });
    expect(lastCard.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(add);
    expect(screen.getByText(t.events.newTier)).toBeInTheDocument();
  });

  it('leaves the header without an add button (only Back)', () => {
    render(<Tiers eventId="evt-1" />);
    // Top: <row> [Back] <div>{title}{sub}</div> [right?] </row>
    const header = screen.getByText(t.events.tiersTitle).parentElement!.parentElement as HTMLElement;
    const buttons = header.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(t.shared.kit.back);
  });

  it('keeps the empty-state CTA when there are no tiers', () => {
    tiersData = [];
    render(<Tiers eventId="evt-1" setup />);
    expect(screen.getByText(t.events.emptyTiersCta)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.events.addAnotherTier })).not.toBeInTheDocument();
  });
});

describe('Edit a tier (item 5)', () => {
  it('opens the form prefilled with the tier', () => {
    render(<Tiers eventId="evt-1" />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) }));

    expect(screen.getByText(t.events.editTier)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(t.events.tierNamePlaceholder)).toHaveValue('Guest');
    expect(screen.getByPlaceholderText(t.events.maxPlaceholder)).toHaveValue('150');
    expect(screen.getByPlaceholderText(t.events.pricePlaceholder)).toHaveValue('10');
    expect(screen.getByPlaceholderText(t.events.vatPlaceholder)).toHaveValue('21');
    // Edit has no "Save & add another".
    expect(screen.queryByRole('button', { name: t.events.saveTierAndNew })).not.toBeInTheDocument();
  });

  it('saves through updateTier with every field explicit and NO aliases', async () => {
    render(<Tiers eventId="evt-1" />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) }));
    fireEvent.change(screen.getByPlaceholderText(t.events.tierNamePlaceholder), { target: { value: 'Guest list' } });
    fireEvent.change(screen.getByPlaceholderText(t.events.pricePlaceholder), { target: { value: '12,50' } });
    fireEvent.click(screen.getByRole('button', { name: t.events.saveTierChanges }));

    await waitFor(() => expect(updateTier).toHaveBeenCalledTimes(1));
    const input = updateTier.mock.calls[0][0];
    expect(input).toEqual({
      tierId: 'tier-guest',
      name: 'Guest list',
      color: '#B5A6FF',
      maxGuests: 150,
      doorPriceCents: 1250,
      vatPercent: 21,
    });
    expect('aliases' in input).toBe(false);
    expect(createTier).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(t.events.editTier)).not.toBeInTheDocument());
  });

  it('turns a paid tier free by clearing its price and VAT in the same update', async () => {
    render(<Tiers eventId="evt-1" />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) }));
    fireEvent.click(screen.getByRole('button', { name: t.events.tierKindFree }));
    fireEvent.click(screen.getByRole('button', { name: t.events.saveTierChanges }));

    await waitFor(() => expect(updateTier).toHaveBeenCalledTimes(1));
    expect(updateTier.mock.calls[0][0]).toMatchObject({ doorPriceCents: null, vatPercent: null });
  });

  it("never blocks the tier's own colour, but still blocks the other tiers' colours", () => {
    render(<Tiers eventId="evt-1" />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) }));

    expect(colorBtn('#B5A6FF')).not.toBeDisabled(); // its own
    expect(colorBtn('#9DE0C0')).toBeDisabled(); // VIP's
    // Move away and back: the own colour stays pickable.
    fireEvent.click(colorBtn('#E8C98A'));
    expect(colorBtn('#B5A6FF')).not.toBeDisabled();
  });

  it('warns (but still saves) when the max drops below what the tier holds', async () => {
    render(<Tiers eventId="evt-1" />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) }));
    expect(screen.queryByText(/already on this tier/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t.events.maxPlaceholder), { target: { value: '10' } });
    expect(screen.getByText(fmt(t.events.maxBelowUsed, { used: 24, max: 10 }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.events.saveTierChanges }));
    await waitFor(() => expect(updateTier).toHaveBeenCalledTimes(1));
    expect(updateTier.mock.calls[0][0]).toMatchObject({ maxGuests: 10 });
  });

  it('shows the server error in the sheet and keeps it open', async () => {
    updateTier.mockRejectedValueOnce(new Error('A tier with this name already exists.'));
    render(<Tiers eventId="evt-1" />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) }));
    fireEvent.change(screen.getByPlaceholderText(t.events.tierNamePlaceholder), { target: { value: 'VIP' } });
    fireEvent.click(screen.getByRole('button', { name: t.events.saveTierChanges }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A tier with this name already exists.');
    expect(screen.getByText(t.events.editTier)).toBeInTheDocument();
  });

  it('gives roles without tier rights a read-only list: no edit, no add, no auto-open', () => {
    canManage = false;
    render(<Tiers eventId="evt-1" />);
    expect(screen.getByText('Guest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fmt(t.events.editTierAria, { name: 'Guest' }) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.events.addAnotherTier })).not.toBeInTheDocument();
    cleanup();

    tiersData = [];
    render(<Tiers eventId="evt-1" />);
    expect(screen.queryByText(t.events.newTier)).not.toBeInTheDocument();
    expect(screen.queryByText(t.events.emptyTiersCta)).not.toBeInTheDocument();
    expect(screen.getByText(t.events.emptyTiers)).toBeInTheDocument();
  });
});

describe('Guided setup step after creating an event (item 7)', () => {
  it('shows the guide, does not auto-open the form, and offers Skip on a tier-less event', () => {
    tiersData = [];
    render(<Tiers eventId="evt-1" setup />);

    expect(screen.getByText(t.events.setupStep.title)).toBeInTheDocument();
    expect(screen.queryByText(t.events.newTier)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.events.setupStep.skip }));
    expect(nav.replace).toHaveBeenCalledWith('event', { id: 'evt-1' });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('offers Go to event once the event has a tier', () => {
    render(<Tiers eventId="evt-1" setup />);
    expect(screen.queryByRole('button', { name: t.events.setupStep.skip })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.events.setupStep.done }));
    expect(nav.replace).toHaveBeenCalledWith('event', { id: 'evt-1' });
  });

  it('keeps the plain visit unguided, auto-opening the form on a tier-less event', () => {
    tiersData = [];
    render(<Tiers eventId="evt-1" />);
    expect(screen.queryByText(t.events.setupStep.title)).not.toBeInTheDocument();
    expect(screen.getByText(t.events.newTier)).toBeInTheDocument();
  });
});
