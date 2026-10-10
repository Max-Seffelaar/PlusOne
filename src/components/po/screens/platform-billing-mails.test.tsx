// @vitest-environment jsdom
/**
 * Platform > Companies — billing-mail timeline (Billing-mails B1, z8uq9m2z19).
 * Collapsed until opened (no read before that); open: the next trial mail
 * from the shared schedule, one line per mail with its delivery counts, and
 * "Pause billing mails" through the platform-admin mutation (the RPC is the
 * boundary, proven in pgTAP billing_mails).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';
import type { PlatformBillingMails } from '@/features/po/adapters';
import { toPlatformBillingMails } from '@/features/po/adapters';

const VENUE_ID = 'aa000000-0000-7000-8000-000000000002';
const D = 86_400_000;

const H = vi.hoisted(() => ({
  data: null as unknown,
  hookCalls: 0,
  pauseMutate: vi.fn(),
}));

vi.mock('@/features/po/hooks', () => ({
  usePoPlatformBillingMails: () => {
    H.hookCalls += 1;
    return { data: H.data, isError: false };
  },
}));
vi.mock('@/features/po/mutations', () => ({
  usePoSetBillingMailsPaused: () => ({ mutate: H.pauseMutate, isPending: false, error: null }),
}));

const { BillingMailTimeline, billingMailStatusLine } = await import('./platform-billing-mails');

function timeline(over: Partial<PlatformBillingMails> = {}): PlatformBillingMails {
  return {
    paused: false,
    subscription: {
      status: 'trialing',
      createdAt: new Date(Date.now() - 3 * D).toISOString(),
      trialEndsAt: new Date(Date.now() + 11 * D).toISOString(),
      stripeLinked: false,
      paused: false,
    },
    mails: [
      {
        type: 'billing_trial_day0',
        key: 'billing_trial_day0',
        firstAt: new Date(Date.now() - 3 * D).toISOString(),
        recipients: 2,
        sending: 0,
        delivered: 1,
        failed: 0,
        bounced: 1,
      },
    ],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  H.hookCalls = 0;
  H.pauseMutate.mockReset();
});

function open(): void {
  render(<BillingMailTimeline venueId={VENUE_ID} name="De Marktzaal" />);
  fireEvent.click(screen.getByRole('button', { name: 'Billing mails for De Marktzaal' }));
}

describe('BillingMailTimeline', () => {
  it('is collapsed and reads nothing until opened', () => {
    H.data = timeline();
    render(<BillingMailTimeline venueId={VENUE_ID} name="De Marktzaal" />);
    expect(screen.getByRole('button', { name: 'Billing mails for De Marktzaal' })).toHaveAttribute('aria-expanded', 'false');
    expect(H.hookCalls).toBe(0);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('open: the next mail from the schedule, and one line per sent mail', () => {
    H.data = timeline();
    open();
    expect(screen.getByText(/^Next: Trial: 7 days left · /)).toBeInTheDocument();
    expect(screen.getByText(t.platform.billingMailTrialDay0)).toBeInTheDocument();
    expect(screen.getByText('2 recipients · 1 delivered · 1 bounced')).toBeInTheDocument();
  });

  it('nothing sent yet, created an hour ago: the welcome mail is next', () => {
    const base = timeline();
    H.data = timeline({
      mails: [],
      subscription: { ...base.subscription!, createdAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    open();
    expect(screen.getByText(t.platform.billingMailsNone)).toBeInTheDocument();
    expect(screen.getByText(/^Next: Welcome, trial started · /)).toBeInTheDocument();
  });

  it('paused: no next mail; the switch resumes through the mutation', () => {
    H.data = timeline({ paused: true });
    open();
    expect(screen.getByText(t.platform.billingMailsNextNone)).toBeInTheDocument();
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    expect(H.pauseMutate).toHaveBeenCalledWith({ venueId: VENUE_ID, paused: false });
  });

  it('pause from the switch', () => {
    H.data = timeline();
    open();
    fireEvent.click(screen.getByRole('switch'));
    expect(H.pauseMutate).toHaveBeenCalledWith({ venueId: VENUE_ID, paused: true });
  });
});

describe('billingMailStatusLine', () => {
  it('singular recipient, only the non-zero statuses', () => {
    expect(
      billingMailStatusLine({
        type: 'billing_payment_failed',
        key: 'stripe:evt_1',
        firstAt: '2026-10-09T10:00:00Z',
        recipients: 1,
        sending: 1,
        delivered: 0,
        failed: 0,
        bounced: 0,
      })
    ).toBe('1 recipient · 1 sent');
  });
});

describe('toPlatformBillingMails', () => {
  it('adapts the RPC jsonb and drops unknown types', () => {
    const tl = toPlatformBillingMails({
      paused: false,
      subscription: { status: 'trialing', created_at: '2026-10-01T10:00:00Z', trial_ends_at: '2026-10-15T10:00:00Z', stripe_linked: false },
      mails: [
        { type: 'billing_trial_day7', dedupe_key: 'billing_trial_day7', first_at: '2026-10-08T10:00:00Z', recipients: 1, sending: 0, delivered: 1, failed: 0, bounced: 0 },
        { type: 'team_join', dedupe_key: 'x', first_at: '2026-10-08T10:00:00Z' },
      ],
    });
    expect(tl.subscription).toMatchObject({ status: 'trialing', trialEndsAt: '2026-10-15T10:00:00Z', paused: false });
    expect(tl.mails).toEqual([
      { type: 'billing_trial_day7', key: 'billing_trial_day7', firstAt: '2026-10-08T10:00:00Z', recipients: 1, sending: 0, delivered: 1, failed: 0, bounced: 0 },
    ]);
  });

  it('survives junk', () => {
    expect(toPlatformBillingMails(null)).toEqual({ paused: false, subscription: null, mails: [] });
  });
});
