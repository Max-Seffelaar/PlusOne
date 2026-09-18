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

let templates: Array<{ id: string; name: string; tierCount: number; landing_active: boolean }> = [];

const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock('@/features/po/hooks', () => ({
  usePoEventForEdit: () => ({ data: null, isLoading: false, isError: false, canManage: true }),
  usePoTemplates: () => ({ data: templates }),
  usePoRequestLinks: () => ({ data: [] }),
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
  usePoUpdateEvent: () => mutation(),
  usePoCreateTemplateFromEvent: () => mutation(),
}));

vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', venueName: 'Club Nova', roles: ['admin'] }),
}));

vi.mock('@/components/po/context', () => ({ useNav: () => nav }));

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
