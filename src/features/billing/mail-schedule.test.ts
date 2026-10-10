import { describe, expect, it } from 'vitest';
import {
  dueBillingMails,
  isBillingMailType,
  nextBillingMail,
  trialMailMoments,
  type BillingMailSubscription,
} from './mail-schedule';

const H = 3_600_000;
const D = 24 * H;

// Created 1 Oct 2026 14:00 UTC; default end = 15 Oct 2026 14:00 UTC.
const CREATED = Date.parse('2026-10-01T14:00:00Z');
const END = CREATED + 14 * D;

function trial(over: Partial<BillingMailSubscription> = {}): BillingMailSubscription {
  return {
    status: 'trialing',
    createdAt: new Date(CREATED).toISOString(),
    trialEndsAt: null,
    stripeLinked: false,
    paused: false,
    ...over,
  };
}

const at = (ms: number) => new Date(ms);

describe('dueBillingMails — the standard 14-day trial, day by day', () => {
  // [day after start (whole days, +1 hour into the window), expected]
  const cases: Array<[number, string[]]> = [
    [0, ['billing_trial_day0']],
    [1, []],
    [6, []],
    [7, ['billing_trial_day7']],
    [8, []],
    [11, []],
    [12, ['billing_trial_day12']],
    [13, []],
    [14, ['billing_trial_ended']],
    [15, []],
    [20, []],
    [21, ['billing_trial_day21']],
    [22, []],
    [30, []],
  ];
  it.each(cases)('day %i (+1 h) -> %j', (day, expected) => {
    expect(dueBillingMails(trial(), at(CREATED + day * D + H))).toEqual(expected);
  });

  it('a mail is due from its moment, not a millisecond before', () => {
    expect(dueBillingMails(trial(), at(END - 1))).toEqual([]);
    expect(dueBillingMails(trial(), at(END))).toEqual(['billing_trial_ended']);
  });

  it('and for 24 hours: the last millisecond is in, the next one out', () => {
    expect(dueBillingMails(trial(), at(END + D - 1))).toEqual(['billing_trial_ended']);
    expect(dueBillingMails(trial(), at(END + D))).toEqual([]);
  });
});

describe('dueBillingMails — a missed day is never caught up', () => {
  it('day 8 without a day-7 mail sends nothing (no catch-up mail)', () => {
    expect(dueBillingMails(trial(), at(END - 7 * D + D + H))).toEqual([]);
  });

  it('a failed run is retried within the 24-hour window (same mail, later run)', () => {
    expect(dueBillingMails(trial(), at(END - 7 * D + 2 * H))).toEqual(['billing_trial_day7']);
    expect(dueBillingMails(trial(), at(END - 7 * D + 20 * H))).toEqual(['billing_trial_day7']);
  });
});

describe('dueBillingMails — the trial-end override moves every reminder', () => {
  it('+30 days: day-12 mail only 2 days before the NEW end', () => {
    const newEnd = END + 30 * D;
    const sub = trial({ trialEndsAt: new Date(newEnd).toISOString() });
    expect(dueBillingMails(sub, at(END - 2 * D + H))).toEqual([]); // the old day 12
    expect(dueBillingMails(sub, at(END + H))).toEqual([]); // the old end
    expect(dueBillingMails(sub, at(newEnd - 2 * D + H))).toEqual(['billing_trial_day12']);
    expect(dueBillingMails(sub, at(newEnd + H))).toEqual(['billing_trial_ended']);
    expect(dueBillingMails(sub, at(newEnd + 7 * D + H))).toEqual(['billing_trial_day21']);
  });

  it('the ADE trial (until 27 Oct 00:00 Amsterdam) matches the copy-review table', () => {
    // created 9 Oct 2026; override = 27 Oct 00:00 CET = 26 Oct 23:00 UTC.
    const sub = trial({ createdAt: '2026-10-09T10:00:00Z', trialEndsAt: '2026-10-26T23:00:00Z' });
    expect(dueBillingMails(sub, at(Date.parse('2026-10-09T10:30:00Z')))).toEqual(['billing_trial_day0']);
    // trial-7 on 20 Oct (Amsterdam), trial-12 on 25 Oct, ended on 27 Oct, trial-21 on 3 Nov.
    expect(dueBillingMails(sub, at(Date.parse('2026-10-20T08:00:00Z')))).toEqual(['billing_trial_day7']);
    expect(dueBillingMails(sub, at(Date.parse('2026-10-25T08:00:00Z')))).toEqual(['billing_trial_day12']);
    expect(dueBillingMails(sub, at(Date.parse('2026-10-27T07:00:00Z')))).toEqual(['billing_trial_ended']);
    expect(dueBillingMails(sub, at(Date.parse('2026-11-03T07:00:00Z')))).toEqual(['billing_trial_day21']);
  });

  it('a short override skips the days already gone: set 24 Oct to end 27 Oct', () => {
    // From the copy review: trial-7 (20 Oct) is skipped, trial-12 goes on 25 Oct.
    const sub = trial({ createdAt: '2026-10-01T10:00:00Z', trialEndsAt: '2026-10-26T23:00:00Z' });
    expect(dueBillingMails(sub, at(Date.parse('2026-10-24T09:00:00Z')))).toEqual([]);
    expect(dueBillingMails(sub, at(Date.parse('2026-10-25T07:00:00Z')))).toEqual(['billing_trial_day12']);
  });

  it('a trial shorter than a day can owe two mails at once, in schedule order', () => {
    const sub = trial({ trialEndsAt: new Date(CREATED + 2 * D).toISOString() });
    expect(dueBillingMails(sub, at(CREATED + H))).toEqual(['billing_trial_day0', 'billing_trial_day12']);
  });
});

describe('dueBillingMails — who never gets a trial mail', () => {
  const everyDay = Array.from({ length: 40 }, (_, d) => CREATED + d * D + H);

  it.each(['comped', 'active', 'past_due', 'canceled'] as const)('%s: nothing, any day', (status) => {
    for (const ms of everyDay) expect(dueBillingMails(trial({ status }), at(ms))).toEqual([]);
  });

  it('paused: nothing, any day', () => {
    for (const ms of everyDay) expect(dueBillingMails(trial({ paused: true }), at(ms))).toEqual([]);
  });

  it('trialing with payment set up (Stripe-linked): only the welcome mail', () => {
    const sub = trial({ stripeLinked: true });
    expect(dueBillingMails(sub, at(CREATED + H))).toEqual(['billing_trial_day0']);
    for (const ms of everyDay.slice(1)) expect(dueBillingMails(sub, at(ms))).toEqual([]);
  });

  it('a malformed date yields nothing instead of throwing', () => {
    expect(dueBillingMails(trial({ createdAt: 'not a date' }), at(CREATED))).toEqual([]);
  });
});

describe('trialMailMoments / nextBillingMail (Platform timeline)', () => {
  it('lists the five moments in order', () => {
    expect(trialMailMoments(trial()).map((m) => [m.type, m.at.toISOString()])).toEqual([
      ['billing_trial_day0', new Date(CREATED).toISOString()],
      ['billing_trial_day7', new Date(END - 7 * D).toISOString()],
      ['billing_trial_day12', new Date(END - 2 * D).toISOString()],
      ['billing_trial_ended', new Date(END).toISOString()],
      ['billing_trial_day21', new Date(END + 7 * D).toISOString()],
    ]);
  });

  it('next = the first mail still ahead or due and not yet sent', () => {
    const now = at(CREATED + 3 * D);
    expect(nextBillingMail(trial(), now, new Set(['billing_trial_day0']))?.type).toBe('billing_trial_day7');
    expect(nextBillingMail(trial(), at(END - 7 * D + H))?.type).toBe('billing_trial_day7');
    expect(nextBillingMail(trial(), at(END - 7 * D + H), new Set(['billing_trial_day7']))?.type).toBe(
      'billing_trial_day12'
    );
  });

  it('a skipped mail is not "next": its window is gone', () => {
    expect(nextBillingMail(trial(), at(END - 7 * D + D + H))?.type).toBe('billing_trial_day12');
  });

  it('nothing next after day 21, or for a paused company', () => {
    expect(nextBillingMail(trial(), at(END + 8 * D + H))).toBeNull();
    expect(nextBillingMail(trial({ paused: true }), at(CREATED))).toBeNull();
  });
});

describe('isBillingMailType', () => {
  it('knows the seven types and nothing else', () => {
    for (const ty of [
      'billing_trial_day0',
      'billing_trial_day7',
      'billing_trial_day12',
      'billing_trial_ended',
      'billing_trial_day21',
      'billing_payment_failed',
      'billing_canceled',
    ]) {
      expect(isBillingMailType(ty)).toBe(true);
    }
    expect(isBillingMailType('team_join')).toBe(false);
    expect(isBillingMailType(7)).toBe(false);
  });
});
