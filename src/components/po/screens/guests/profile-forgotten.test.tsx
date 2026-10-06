// @vitest-environment jsdom
/**
 * z8uq9m2x43 — a forgotten (anonymized) contact is read-only on the person
 * profile: no Edit, no "Add to event", no Regular star; a plain note instead.
 * A live contact keeps all three. The DB refuses the writes regardless
 * (contacts_freeze_anonymized pgTAP); this pins that the screen offers none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { t } from '@/lib/i18n';
import type { PoContactProfile } from '@/features/po/adapters';

const H = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  profile: null as unknown,
}));

vi.mock('@/features/po/hooks', () => ({
  usePoPersonProfile: () => ({ data: H.profile, isLoading: false, isError: false }),
  usePoEvents: () => ({ data: [] }),
  usePoContacts: () => ({ data: [] }),
  usePoContactOptIns: () => ({ data: new Set<string>() }),
  usePoOrganizerEventIds: () => [],
}));
vi.mock('@/features/po/mutations', () => ({
  usePoToggleContactPermanent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'v1', userId: 'u-me', roles: H.roles }),
}));
vi.mock('../../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('./profile-sheets', () => ({
  PromoteSheet: () => null,
  ContactEditSheet: () => null,
  ForgetConfirmSheet: () => null,
  PermanentConfirmSheet: () => null,
  AddToEventSheet: () => null,
}));
vi.mock('./bulk-add', () => ({
  useGuestSelection: () => ({ selected: new Set(), toggle: vi.fn(), clear: vi.fn(), selectAll: vi.fn() }),
  BulkAddToEventSheet: () => null,
}));
vi.mock('./profile-event-actions', () => ({ EventRowActions: () => null }));

const { ContactProfile } = await import('./profile');
const cp = t.guests.contactProfile;

function profile(over: Partial<PoContactProfile> = {}): PoContactProfile {
  return {
    id: 'c1',
    name: 'Anouk Smit',
    role: 'VIP',
    vast: false,
    email: 'anouk@mail.nl',
    phone: '+31612345678',
    birthday: null,
    note: null,
    since: '3 Nov 2024',
    eventsCount: 0,
    attendedCount: 0,
    refusedCount: 0,
    plusOnesTotal: 0,
    events: [],
    timeline: [],
    isContact: true,
    promoteGuestId: null,
    restricted: false,
    forgotten: false,
    phoneLast4: '5678',
    birthdate: null,
    preferredRole: 'vip',
    ...over,
  };
}

beforeEach(() => {
  H.roles = ['admin'];
});

describe('ContactProfile — forgotten contact is read-only', () => {
  it('a live contact offers Edit, Add to event and the Regular star', () => {
    H.profile = profile();
    render(<ContactProfile contactId="c1" />);
    expect(screen.getByRole('button', { name: cp.edit })).toBeTruthy();
    expect(screen.getByRole('button', { name: cp.addToEvent })).toBeTruthy();
    expect(screen.getByTitle(cp.makeRegular)).toBeTruthy();
    expect(screen.queryByText(cp.forgottenNote)).toBeNull();
  });

  it('a forgotten contact offers none of them and shows the forgotten note', () => {
    H.profile = profile({ name: 'Contact #7', email: null, phone: null, phoneLast4: null, forgotten: true });
    render(<ContactProfile contactId="c1" />);
    expect(screen.queryByRole('button', { name: cp.edit })).toBeNull();
    expect(screen.queryByRole('button', { name: cp.addToEvent })).toBeNull();
    expect(screen.queryByTitle(cp.makeRegular)).toBeNull();
    expect(screen.queryByTitle(cp.unmakeRegular)).toBeNull();
    expect(screen.getByText(cp.forgottenNote)).toBeTruthy();
  });

  it('the history stays readable for a forgotten contact', () => {
    H.profile = profile({ name: 'Contact #7', forgotten: true });
    render(<ContactProfile contactId="c1" />);
    expect(screen.getByText('Contact #7')).toBeTruthy();
    expect(screen.getByText(cp.eventsTitle)).toBeTruthy();
    expect(screen.getByText(cp.timelineTitle)).toBeTruthy();
  });
});
