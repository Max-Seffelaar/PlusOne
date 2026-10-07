// @vitest-environment jsdom
/**
 * New-event form (z8uq9m0hw3): where "Create event" goes, and what the sign-up
 * link toggle starts at.
 *
 * Item 7 (Max: "first save the event, then create the tiers"): a blank event is
 * REPLACED by its guided tiers step; a template that seeded tiers skips it and
 * lands on the event detail, where the guided step also ends (Max, PR #305).
 * `replace`, never `push`, so Back from the next screen lands where the create
 * flow started.
 * Item 6: the sign-up link is on for a new event, and a picked template shows
 * its own setting on the (read-only) toggle.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const NEW_ID = 'e0000000-0000-4000-8000-0000000000aa';
const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: true };
const createEvent = vi.fn().mockResolvedValue(NEW_ID);
const createFromTemplate = vi.fn().mockResolvedValue(NEW_ID);

let templates: Array<{ id: string; name: string; tierCount: number; landing_active: boolean; location_name?: string | null; location_address?: string | null }> = [];

const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
const updateEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/po/hooks', () => ({
  usePoEventForEdit: () => ({ data: null, isLoading: false, isError: false, canManage: true }),
  usePoTemplates: () => ({ data: templates }),
  usePoRequestLinks: () => ({ data: [] }),
  usePoVenueSettings: () => ({ data: { addressLine: 'Wibautstraat 150', postalCode: '1091 GR', city: 'Amsterdam' } }),
}));

vi.mock('@/features/po/mutations', () => ({
  usePoCreateEvent: () => ({ mutateAsync: createEvent, isPending: false }),
  usePoCreateEventFromTemplate: () => ({ mutateAsync: createFromTemplate, isPending: false }),
  usePoSetCancelled: () => mutation(),
  usePoSetAllowUncheck: () => mutation(),
  usePoSetAutoLock: () => mutation(),
  usePoSetEventDefaultMemberQuota: () => mutation(),
  usePoSetLandingActive: () => mutation(),
  usePoSetListLock: () => mutation(),
  usePoUpdateEvent: () => ({ mutateAsync: updateEvent, isPending: false }),
  usePoCreateTemplateFromEvent: () => mutation(),
}));

vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', venueName: 'Club Nova', roles: ['admin'] }),
}));

const toast = vi.fn();
vi.mock('@/components/po/context', () => ({ useNav: () => nav, usePo: () => ({ toast }) }));

// Imported AFTER the mocks so the screen picks them up.
import { EventEdit } from './edit';
import { SaveAsTemplate } from './save-as-template';

beforeAll(() => {
  // Desktop fields (typeable date/time comboboxes), as in schedule-fields.test.
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('min-width: 1024px'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
});

beforeEach(() => {
  templates = [];
  vi.clearAllMocks();
  createEvent.mockResolvedValue(NEW_ID);
  createFromTemplate.mockResolvedValue(NEW_ID);
  updateEvent.mockResolvedValue(undefined);
});

afterEach(cleanup);

function fillAndCreate(): void {
  fireEvent.change(screen.getByPlaceholderText(t.events.namePlaceholder), { target: { value: 'Smoke Night' } });
  const [date] = screen.getAllByRole('combobox', { name: t.shared.datetime.dateAria });
  fireEvent.change(date, { target: { value: '16-10-2026' } });
  fireEvent.keyDown(date, { key: 'Enter' });
  const [doors] = screen.getAllByRole('combobox', { name: t.shared.datetime.hourAria });
  fireEvent.change(doors, { target: { value: '23:00' } });
  fireEvent.keyDown(doors, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: t.events.createEvent }));
}

describe('EventEdit create flow (item 7)', () => {
  it('replaces a blank new event with its guided tiers step', async () => {
    render(<EventEdit isNew />);
    fillAndCreate();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    expect(nav.replace).toHaveBeenCalledWith('tiers', { id: NEW_ID, setup: true });
    expect(nav.push).not.toHaveBeenCalled();
    // The sign-up link default (item 6) is what the blank create writes.
    expect(createEvent.mock.calls[0][0]).toMatchObject({ name: 'Smoke Night', landingActive: true });
  });

  it('skips the tiers step and lands on the event detail when the template seeded tiers', async () => {
    templates = [{ id: 'tpl-1', name: 'Lofi', tierCount: 2, landing_active: false }];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Lofi' }));
    fillAndCreate();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    expect(createFromTemplate).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith('event', { id: NEW_ID });
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('still shows the tiers step for a template without tiers', async () => {
    templates = [{ id: 'tpl-1', name: 'Lofi', tierCount: 0, landing_active: true }];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Lofi' }));
    fillAndCreate();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('tiers', { id: NEW_ID, setup: true }));
  });
});

describe('EventEdit sign-up link toggle on a new event (item 6)', () => {
  const toggle = (): HTMLElement => screen.getByRole('switch');

  it('starts on for a blank event', () => {
    render(<EventEdit isNew />);
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });

  it("shows the picked template's own setting, and ignores taps", () => {
    templates = [
      { id: 'tpl-off', name: 'Private', tierCount: 1, landing_active: false },
      { id: 'tpl-on', name: 'Open air', tierCount: 1, landing_active: true },
    ];
    render(<EventEdit isNew />);

    fireEvent.click(screen.getByRole('button', { name: 'Private' }));
    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Open air' }));
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
  });
});

// Item 8 (Max, PR #305): the section is labelled "Template", the button keeps
// "Save as template"; "Reuse this setup" is gone.
describe('SaveAsTemplate copy (item 8)', () => {
  it('labels the section "Template" above the "Save as template" button', () => {
    render(<SaveAsTemplate eventId={NEW_ID} />);
    expect(screen.getByText('Template')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as template' })).toBeInTheDocument();
    expect(screen.queryByText('Reuse this setup')).not.toBeInTheDocument();
  });
});

// Per-event location (z8uq9m2vqc): the company is the placeholder, a typed
// location is written with the create, and an empty one stays null.
describe('EventEdit location fields', () => {
  it('shows the company name and address as placeholders', () => {
    render(<EventEdit isNew />);
    expect(screen.getByRole('textbox', { name: t.events.locationNameAria })).toHaveAttribute('placeholder', 'Club Nova');
    expect(screen.getByRole('textbox', { name: t.events.locationAddressAria })).toHaveAttribute(
      'placeholder',
      'Wibautstraat 150, 1091 GR Amsterdam'
    );
  });

  it('writes a typed location with the create, trimmed', async () => {
    render(<EventEdit isNew />);
    fireEvent.change(screen.getByRole('textbox', { name: t.events.locationNameAria }), { target: { value: '  Paradiso ' } });
    fireEvent.change(screen.getByRole('textbox', { name: t.events.locationAddressAria }), {
      target: { value: 'Weteringschans 6, Amsterdam' },
    });
    fillAndCreate();
    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(createEvent.mock.calls[0][0]).toMatchObject({ locationName: 'Paradiso', locationAddress: 'Weteringschans 6, Amsterdam' });
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('leaves an untouched location null (= follow the company)', async () => {
    render(<EventEdit isNew />);
    fillAndCreate();
    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(createEvent.mock.calls[0][0]).toMatchObject({ locationName: null, locationAddress: null });
  });

  it('sets the location on an event created from a template (the RPC takes none)', async () => {
    templates = [{ id: 'tpl-1', name: 'Lofi', tierCount: 2, landing_active: false }];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Lofi' }));
    fireEvent.change(screen.getByRole('textbox', { name: t.events.locationNameAria }), { target: { value: 'Paradiso' } });
    fillAndCreate();
    await waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent).toHaveBeenCalledWith({ eventId: NEW_ID, locationName: 'Paradiso', locationAddress: null });
  });
});

// Review fix: on the template path the event already exists when the location
// write runs. A failure there must still move on to the new event (a second
// Save would create a second event) and tell the user via the shell toast.
describe('EventEdit template path, location write fails', () => {
  it('navigates to the new event anyway and toasts that the location did not save', async () => {
    updateEvent.mockRejectedValueOnce(new Error('network'));
    templates = [{ id: 'tpl-1', name: 'Lofi', tierCount: 2, landing_active: false }];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Lofi' }));
    fireEvent.change(screen.getByRole('textbox', { name: t.events.locationNameAria }), { target: { value: 'Paradiso' } });
    fillAndCreate();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('event', { id: NEW_ID }));
    expect(createFromTemplate).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(t.events.locationNotSaved);
    expect(screen.queryByText('network')).not.toBeInTheDocument();
  });
});

// Templates keep the location (20261007135000): the RPC copies the template's
// location onto the event, the form prefills it on pick, and only a change the
// user made is written in a second step.
describe('EventEdit template location prefill', () => {
  const withLoc = { id: 'tpl-loc', name: 'Offsite', tierCount: 1, landing_active: true, location_name: 'Paradiso', location_address: 'Weteringschans 6' };

  it('prefills the location from the picked template and clears it when un-picked', () => {
    templates = [withLoc];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    expect(screen.getByRole('textbox', { name: t.events.locationNameAria })).toHaveValue('Paradiso');
    expect(screen.getByRole('textbox', { name: t.events.locationAddressAria })).toHaveValue('Weteringschans 6');
    fireEvent.click(screen.getByRole('button', { name: t.events.templateBlank }));
    expect(screen.getByRole('textbox', { name: t.events.locationNameAria })).toHaveValue('');
  });

  it('always writes the location the form showed after a template create (never diffs against the cache)', async () => {
    // The cache says Paradiso; the RPC copies whatever the template holds in
    // the DB right now (another admin may have changed it). The event must end
    // up with what this user saw and kept: the form value.
    templates = [withLoc];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    fillAndCreate();
    await waitFor(() => expect(createFromTemplate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent).toHaveBeenCalledWith({ eventId: NEW_ID, locationName: 'Paradiso', locationAddress: 'Weteringschans 6' });
  });

  // Review #419: a chip tap never overwrites a location the user typed.
  const nameBox = (): HTMLElement => screen.getByRole('textbox', { name: t.events.locationNameAria });
  const addrBox = (): HTMLElement => screen.getByRole('textbox', { name: t.events.locationAddressAria });
  const noLoc = { id: 'tpl-none', name: 'Plain', tierCount: 1, landing_active: true, location_name: null, location_address: null };

  it('keeps a typed location when a template without a location is picked', () => {
    templates = [withLoc, noLoc];
    render(<EventEdit isNew />);
    fireEvent.change(nameBox(), { target: { value: 'Melkweg' } });
    fireEvent.change(addrBox(), { target: { value: 'Lijnbaansgracht 234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plain' }));
    expect(nameBox()).toHaveValue('Melkweg');
    expect(addrBox()).toHaveValue('Lijnbaansgracht 234');
    // …and a template WITH a location doesn't replace it either.
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    expect(nameBox()).toHaveValue('Melkweg');
  });

  it('keeps an edited prefill when the same template is tapped again', () => {
    templates = [withLoc];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    fireEvent.change(nameBox(), { target: { value: 'Paradiso Noord' } });
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    expect(nameBox()).toHaveValue('Paradiso Noord');
    expect(addrBox()).toHaveValue('Weteringschans 6');
  });

  it('keeps a location typed under "Blank" when "Blank" is tapped again', () => {
    templates = [withLoc];
    render(<EventEdit isNew />);
    fireEvent.change(nameBox(), { target: { value: 'Melkweg' } });
    fireEvent.click(screen.getByRole('button', { name: t.events.templateBlank }));
    expect(nameBox()).toHaveValue('Melkweg');
  });

  it('swaps an untouched prefill when another template is picked', () => {
    templates = [withLoc, { ...noLoc, id: 'tpl-2', name: 'Melkweg nights', location_name: 'Melkweg', location_address: 'Lijnbaansgracht 234' }];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Melkweg nights' }));
    expect(nameBox()).toHaveValue('Melkweg');
    expect(addrBox()).toHaveValue('Lijnbaansgracht 234');
  });

  it('does not make the form dirty just by picking a template with a location', () => {
    templates = [withLoc];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it('writes an overridden location after the template create, empty = back to the company', async () => {
    templates = [withLoc];
    render(<EventEdit isNew />);
    fireEvent.click(screen.getByRole('button', { name: 'Offsite' }));
    fireEvent.change(screen.getByRole('textbox', { name: t.events.locationNameAria }), { target: { value: 'Melkweg' } });
    fireEvent.change(screen.getByRole('textbox', { name: t.events.locationAddressAria }), { target: { value: '' } });
    fillAndCreate();
    await waitFor(() => expect(updateEvent).toHaveBeenCalledTimes(1));
    expect(updateEvent).toHaveBeenCalledWith({ eventId: NEW_ID, locationName: 'Melkweg', locationAddress: null });
  });
});

// Max 2026-10-07: a new event is always created in the active company, so the
// read-only Company field is gone from the create form.
describe('EventEdit create form', () => {
  it('has no Company field', () => {
    render(<EventEdit isNew />);
    expect(screen.queryByText(t.events.fieldVenue)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: t.events.locationNameAria })).toHaveAttribute('placeholder', 'Club Nova');
  });
});
