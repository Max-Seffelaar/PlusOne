/**
 * Platform R (z8uq9m2ybj) — the company view-model both Platform lists share,
 * its status chip, the invite's company_ids, and MRR/ARR from our records.
 */
import { describe, expect, it } from 'vitest';
import {
  platformCompanyStatus,
  platformRevenue,
  toPlatformCompany,
  toPlatformInvite,
} from './adapters';
import type { PlatformCompanyRow, PlatformInviteRow } from './queries';
import { companyActivityLine, companyEventsLine, companyStatusLabel } from '@/components/po/screens/platform-company';

const NOW = Date.parse('2026-10-08T12:00:00.000Z');

function row(over: Partial<PlatformCompanyRow> = {}): PlatformCompanyRow {
  return {
    venue_id: 'aa000000-0000-7000-8000-000000000002',
    name: 'De Marktzaal',
    subscription_status: 'trialing',
    billing_interval: null,
    stripe_linked: false,
    trial_ends_at: '2026-10-17T11:00:00.000Z',
    owner_last_sign_in_at: null,
    last_check_in_at: null,
    event_count: 0,
    last_event_name: null,
    last_event_starts_at: null,
    ...over,
  };
}

describe('toPlatformCompany', () => {
  it('normalises the runtime-nullable columns', () => {
    const c = toPlatformCompany(row({ stripe_linked: null, event_count: null, subscription_status: null }));
    expect(c.stripeLinked).toBe(false);
    expect(c.eventCount).toBe(0);
    expect(c.status).toBeNull();
    expect(c.lastEvent).toBeNull();
  });

  it('drops an unknown interval or status instead of trusting it', () => {
    const c = toPlatformCompany(row({ billing_interval: 'week', subscription_status: 'weird' }));
    expect(c.interval).toBeNull();
    expect(c.status).toBeNull();
  });
});

describe('platformCompanyStatus + label', () => {
  it('a running trial counts Amsterdam calendar days left', () => {
    const c = toPlatformCompany(row());
    expect(platformCompanyStatus(c, NOW)).toEqual({ kind: 'trial', daysLeft: 9 });
    expect(companyStatusLabel(c, NOW)).toBe('Trial · 9 days left');
  });

  it('a trial ending later today reads "ends today", not "1 day left"', () => {
    const c = toPlatformCompany(row({ trial_ends_at: '2026-10-08T14:00:00.000Z' }));
    expect(companyStatusLabel(c, NOW)).toBe('Trial · ends today');
    const tomorrow = toPlatformCompany(row({ trial_ends_at: '2026-10-09T10:00:00.000Z' }));
    expect(companyStatusLabel(tomorrow, NOW)).toBe('Trial · 1 day left');
  });

  it('a Stripe-linked trial shows no countdown, also once our own date has passed', () => {
    const past = toPlatformCompany(row({ stripe_linked: true, trial_ends_at: '2026-09-18T00:00:00.000Z' }));
    expect(companyStatusLabel(past, NOW)).toBe('Trial · billing via Stripe');
  });

  it('a passed trial without Stripe reads as ended', () => {
    const c = toPlatformCompany(row({ trial_ends_at: '2026-10-01T00:00:00.000Z' }));
    expect(companyStatusLabel(c, NOW)).toBe('Trial ended');
  });

  it('paid monthly / yearly / comped / past due / canceled', () => {
    const label = (over: Partial<PlatformCompanyRow>) =>
      companyStatusLabel(toPlatformCompany(row({ trial_ends_at: null, ...over })), NOW);
    expect(label({ subscription_status: 'active', billing_interval: 'month' })).toBe('Paid monthly');
    expect(label({ subscription_status: 'active', billing_interval: 'year' })).toBe('Paid yearly');
    expect(label({ subscription_status: 'comped' })).toBe('Always free');
    expect(label({ subscription_status: 'past_due' })).toBe('Past due');
    expect(label({ subscription_status: 'canceled' })).toBe('Canceled');
  });
});

describe('company lines', () => {
  it('events line: count + latest event, or "No events yet"', () => {
    expect(companyEventsLine(toPlatformCompany(row()))).toBe('No events yet');
    const c = toPlatformCompany(
      row({ event_count: 3, last_event_name: 'Nova Night', last_event_starts_at: '2026-10-04T20:00:00.000Z' }),
    );
    expect(companyEventsLine(c)).toBe('3 events · latest: Nova Night, 4 Oct');
  });

  it('activity line: owner login + last check-in', () => {
    const c = toPlatformCompany(
      row({ owner_last_sign_in_at: '2026-10-06T09:00:00.000Z', last_check_in_at: '2026-10-05T23:30:00.000Z' }),
    );
    expect(companyActivityLine(c, NOW)).toBe('Last login 2 days ago · last check-in 6 Oct');
    expect(companyActivityLine(toPlatformCompany(row()), NOW)).toBe('Owner never logged in · no check-ins yet');
  });
});

describe('toPlatformInvite company_ids', () => {
  const invite: PlatformInviteRow = {
    id: '018f3a2e-0000-7000-8000-000000000001',
    email: 'venue@example.com',
    note: null,
    created_at: '2026-09-01T10:00:00.000Z',
    last_sent_at: '2026-09-01T10:00:00.000Z',
    revoked_at: null,
    invited_by_name: null,
    user_id: null,
    confirmed_at: null,
    last_sign_in_at: null,
    venue_count: 0,
    event_count: 0,
    stage: 'invited',
  };

  it('a server without the column (expand-contract) means no companies', () => {
    expect(toPlatformInvite(invite).companyIds).toEqual([]);
    expect(toPlatformInvite({ ...invite, company_ids: null }).companyIds).toEqual([]);
    expect(toPlatformInvite({ ...invite, company_ids: ['a', 'b'] }).companyIds).toEqual(['a', 'b']);
  });
});

describe('platformRevenue (MRR/ARR from our records)', () => {
  const prices = {
    month: { interval: 'month' as const, unitAmount: 4900, currency: 'eur' },
    year: { interval: 'year' as const, unitAmount: 46800, currency: 'eur' },
  };

  it('monthly × monthly price + yearly × yearly price / 12; ARR = MRR × 12', () => {
    expect(platformRevenue({ paidMonthly: 3, paidYearly: 2, paidUnknown: 0 }, prices)).toEqual({
      mrr: 3 * 4900 + (2 * 46800) / 12,
      arr: (3 * 4900 + (2 * 46800) / 12) * 12,
      currency: 'eur',
      leftOut: 0,
    });
  });

  it('no prices (stub / no Stripe key) → null, the UI shows "—"', () => {
    expect(platformRevenue({ paidMonthly: 3, paidYearly: 0, paidUnknown: 0 }, null)).toBeNull();
  });

  it('a missing price for a bucket that has payers → null, never a guess', () => {
    expect(platformRevenue({ paidMonthly: 0, paidYearly: 1, paidUnknown: 0 }, { ...prices, year: null })).toBeNull();
    expect(platformRevenue({ paidMonthly: 1, paidYearly: 0, paidUnknown: 0 }, { ...prices, year: null })).toEqual({
      mrr: 4900,
      arr: 58800,
      currency: 'eur',
      leftOut: 0,
    });
  });

  it('paid companies with no known interval are left out of the amount, and counted', () => {
    // 5 legacy payers + 1 known monthly: the amount is the one we can price,
    // and leftOut tells the UI to say the other 5 are not in it.
    expect(platformRevenue({ paidMonthly: 1, paidYearly: 0, paidUnknown: 5 }, prices)).toEqual({
      mrr: 4900,
      arr: 58800,
      currency: 'eur',
      leftOut: 5,
    });
  });

  it('mixed currencies → null', () => {
    expect(
      platformRevenue({ paidMonthly: 1, paidYearly: 1, paidUnknown: 0 }, { ...prices, year: { ...prices.year, currency: 'usd' } }),
    ).toBeNull();
  });
});
