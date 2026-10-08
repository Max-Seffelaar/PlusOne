// @vitest-environment jsdom
/**
 * Platform > Invites — company chips (z8uq9m2ybj, scope A). An invite whose
 * invitee created a company shows a chip with the shared company detail; its
 * Switch and its events line both go through the shell's `switchToVenue` (the
 * path that writes platform_access_log for a non-member — never a bespoke
 * cookie write). For the company that is already active, the events line
 * opens the Events tab directly, because switchToVenue no-ops on it.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';
import type { PlatformCompany, PlatformInvite } from '@/features/po/adapters';

const VENUE = 'aa000000-0000-7000-8000-000000000002';
const ACTIVE = 'aa000000-0000-7000-8000-000000000001';

const H = vi.hoisted(() => ({
  switchToVenue: vi.fn(),
  setTab: vi.fn(),
  companyIdsSeen: [] as string[][],
}));

function company(id: string, name: string): PlatformCompany {
  return {
    venueId: id,
    name,
    status: 'active',
    interval: 'month',
    stripeLinked: true,
    trialEndsAt: null,
    ownerLastSignInAt: null,
    lastCheckInAt: null,
    eventCount: 3,
    lastEvent: { name: 'Nova Night', startsAt: '2026-10-04T20:00:00.000Z' },
  };
}

const INVITE: PlatformInvite = {
  id: '018f3a2e-0000-7000-8000-000000000001',
  email: 'owner@example.com',
  anonymized: false,
  note: null,
  stage: 'first_event',
  stageIndex: 3,
  revoked: false,
  invitedAt: '2026-09-01T10:00:00.000Z',
  lastSentAt: '2026-09-01T10:00:00.000Z',
  revokedAt: null,
  invitedByName: null,
  signedIn: true,
  venueCount: 2,
  eventCount: 6,
  companyIds: [VENUE, ACTIVE],
};

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), setTab: H.setTab, canGoBack: false }),
  usePo: () => ({ switchToVenue: H.switchToVenue }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: ACTIVE, roles: [] }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => true,
  usePoPlatformInvites: () => ({ data: [INVITE], isLoading: false, isError: false }),
  usePoPlatformFunnel: () => ({ data: undefined }),
  usePoPlatformCompanies: (ids: string[]) => {
    H.companyIdsSeen.push(ids);
    return {
      data: new Map([
        [VENUE, company(VENUE, 'De Marktzaal')],
        [ACTIVE, company(ACTIVE, 'Club Vesper')],
      ]),
      isError: false,
    };
  },
}));
vi.mock('@/features/po/mutations', () => ({
  usePoInviteBetaCustomer: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
  usePoResendBetaInvite: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
  usePoRevokeBetaInvite: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
}));

const { Platform } = await import('./platform');

afterEach(() => {
  cleanup();
  H.switchToVenue.mockReset();
  H.setTab.mockReset();
  H.companyIdsSeen = [];
});

describe('Platform > Invites company chips (z8uq9m2ybj)', () => {
  it('reads the detail for the page\'s companies in one call and renders a chip per company', () => {
    render(<Platform />);
    expect(H.companyIdsSeen.at(-1)).toEqual([ACTIVE, VENUE].sort());
    expect(screen.getByText('De Marktzaal')).toBeDefined();
    expect(screen.getByText('Club Vesper')).toBeDefined();
    expect(screen.getAllByText(t.platform.companyPaidMonthly)).toHaveLength(2);
  });

  it('Switch goes through the shell switch path', () => {
    render(<Platform />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.platform.companySwitchAria, { name: 'De Marktzaal' }) }));
    expect(H.switchToVenue).toHaveBeenCalledWith(VENUE);
  });

  it('the already-active company has no Switch (it would do nothing)', () => {
    render(<Platform />);
    expect(screen.queryByRole('button', { name: fmt(t.platform.companySwitchAria, { name: 'Club Vesper' }) })).toBeNull();
  });

  it('the events line switches and lands on Events; the active company opens Events directly', () => {
    render(<Platform />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.platform.companyEventsAria, { name: 'De Marktzaal' }) }));
    expect(H.switchToVenue).toHaveBeenCalledWith(VENUE, '/app/events');
    fireEvent.click(screen.getByRole('button', { name: fmt(t.platform.companyEventsAria, { name: 'Club Vesper' }) }));
    expect(H.setTab).toHaveBeenCalledWith('events');
    expect(H.switchToVenue).toHaveBeenCalledTimes(1);
  });
});
