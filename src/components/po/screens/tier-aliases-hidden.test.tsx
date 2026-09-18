// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';
import { TIER_ALIASES_UI } from '@/features/guests/tiers';

// ADE UX round, item E (17/9/2026): the tier ALIAS interface is hidden behind
// TIER_ALIASES_UI in all three create-a-tier forms, and the forms must never
// overwrite stored aliases — with the flag off a create sends `aliases: []`.
// Item F: the tier-name placeholder example is "Guest".

const createTier = vi.fn().mockResolvedValue(undefined);
const createTemplateTier = vi.fn().mockResolvedValue(undefined);

const tierRow = {
  id: 'tier-1',
  name: 'VIP',
  short: 'VIP',
  role: 'VIP',
  color: '#B5A6FF',
  max: null,
  used: 3,
  doorPrice: 0,
  vatPercent: null,
  isDefault: false,
  aliases: ['bottle', 'champagne'],
};

let tiersData: unknown[] = [];

vi.mock('@/features/po/hooks', () => ({
  usePoEvent: () => ({ event: { id: 'evt-1', name: 'FRENZY' } }),
  usePoTiers: () => ({ data: tiersData, isLoading: false, isError: false }),
  usePoTemplate: () => ({ data: { id: 'tpl-1', name: 'Lofi', capacity: null, landing_active: false, allow_uncheck: null, auto_lock_offset_minutes: null }, isLoading: false }),
  usePoTemplateTiers: () => ({ data: [{ id: 'ttier-1', name: 'VIP', color: '#B5A6FF', max_guests: null, door_price_cents: null, vat_percent: null, aliases: ['bottle'] }], isLoading: false }),
  usePoCanManageTemplates: () => true,
}));

vi.mock('@/features/po/mutations', () => ({
  usePoCreateTier: () => ({ mutateAsync: createTier, isPending: false }),
  usePoUpdateTier: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePoCreateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePoUpdateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePoDeleteTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePoCreateTemplateTier: () => ({ mutateAsync: createTemplateTier, isPending: false }),
  usePoDeleteTemplateTier: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1' }),
}));

vi.mock('@/components/po/context', () => ({
  useNav: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: true }),
}));

// Imported AFTER the mocks so the screens pick them up.
import { Tiers } from './events/tiers';
import { NoTiersBlock } from './guests/_shared';
import { TemplateEdit } from './templates';

beforeEach(() => {
  createTier.mockClear();
  createTemplateTier.mockClear();
  tiersData = [];
});

/** Nothing on screen may mention aliases while the flag is off. */
function expectNoAliasUi(): void {
  expect(screen.queryByText(t.events.aliases)).not.toBeInTheDocument();
  expect(screen.queryByText(t.events.aliasesFeedLabel)).not.toBeInTheDocument();
  expect(screen.queryByText(t.events.aliasesNote)).not.toBeInTheDocument();
  expect(screen.queryByText(t.guests.tierCreate.aliasLabel)).not.toBeInTheDocument();
  expect(screen.queryByText(t.templates.aliasesLabel)).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(t.events.aliasesPlaceholder)).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(t.events.aliasInputPlaceholder)).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(t.guests.tierCreate.aliasPlaceholder)).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(t.templates.aliasesPlaceholder)).not.toBeInTheDocument();
}

describe('TIER_ALIASES_UI', () => {
  it('is off — the alias feature is hidden while it waits for a better design', () => {
    expect(TIER_ALIASES_UI).toBe(false);
  });
});

describe('Tiers screen (events/tiers.tsx) with the alias UI off', () => {
  it('shows no alias banner, label or field in the create-tier form', () => {
    // An event without tiers auto-opens the create form.
    render(<Tiers eventId="evt-1" />);

    expect(screen.getByText(t.events.newTier)).toBeInTheDocument();
    expectNoAliasUi();
  });

  it('uses "Guest" as the tier-name example (item F)', () => {
    render(<Tiers eventId="evt-1" />);

    expect(screen.getByPlaceholderText('Name, e.g. "Guest"')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Backstage/)).not.toBeInTheDocument();
  });

  it('creates a tier with an empty alias list, never a half-filled one', async () => {
    render(<Tiers eventId="evt-1" />);

    fireEvent.change(screen.getByPlaceholderText(t.events.tierNamePlaceholder), { target: { value: 'Guest' } });
    fireEvent.click(screen.getByRole('button', { name: t.events.saveTier }));
    await waitFor(() => expect(createTier).toHaveBeenCalledTimes(1));

    expect(createTier.mock.calls[0][0]).toMatchObject({ eventId: 'evt-1', name: 'Guest', aliases: [] });
  });

  it('hides the stored aliases of an existing tier without touching the data', () => {
    tiersData = [tierRow];
    render(<Tiers eventId="evt-1" />);

    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.queryByText('bottle')).not.toBeInTheDocument();
    expect(screen.queryByText('champagne')).not.toBeInTheDocument();
    expect(screen.queryByText(t.events.aliasAdd)).not.toBeInTheDocument();
    expectNoAliasUi();
  });
});

describe('Inline create-a-tier form (guests/_shared.tsx) with the alias UI off', () => {
  it('shows no alias label or field and creates with an empty alias list', async () => {
    render(<NoTiersBlock eventId="evt-1" canCreate />);
    fireEvent.click(screen.getByRole('button', { name: t.guests.tierCreate.createBtn }));

    expectNoAliasUi();

    fireEvent.change(screen.getByPlaceholderText(t.guests.tierCreate.namePlaceholder), { target: { value: 'Guest' } });
    fireEvent.click(screen.getByRole('button', { name: t.guests.tierCreate.createBtn }));
    await waitFor(() => expect(createTier).toHaveBeenCalledTimes(1));

    expect(createTier.mock.calls[0][0]).toMatchObject({ eventId: 'evt-1', name: 'Guest', aliases: [] });
  });
});

describe('Template tier editor (templates.tsx) with the alias UI off', () => {
  function openTierForm(): void {
    const header = screen.getByText(t.templates.tiersLabel).parentElement as HTMLElement;
    fireEvent.click(within(header).getByRole('button'));
  }

  it('shows no alias field and creates a template tier with an empty alias list', async () => {
    render(<TemplateEdit id="tpl-1" />);
    openTierForm();

    expect(screen.getByText(t.templates.newTier)).toBeInTheDocument();
    expectNoAliasUi();

    fireEvent.change(screen.getByPlaceholderText(t.templates.tierNamePlaceholder), { target: { value: 'Guest' } });
    fireEvent.click(screen.getByRole('button', { name: t.templates.addTier }));
    await waitFor(() => expect(createTemplateTier).toHaveBeenCalledTimes(1));

    expect(createTemplateTier.mock.calls[0][0]).toMatchObject({ templateId: 'tpl-1', name: 'Guest', aliases: [] });
  });

  it('does not print the stored aliases of a template tier in its summary line', () => {
    render(<TemplateEdit id="tpl-1" />);

    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.queryByText(/bottle/)).not.toBeInTheDocument();
  });
});
