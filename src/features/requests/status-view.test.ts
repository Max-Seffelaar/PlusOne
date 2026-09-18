// z8uq9m0hw6 — the /r/[token] adapter. The RPC decides what a token may see;
// these pin that the page never shows MORE than the state allows even if a
// payload did, that anything unrecognised is the neutral not-found (#28), and
// the time/address formatting.
import { describe, expect, it } from 'vitest';
import { formatWeekdayDate } from '@/features/po/format';
import { formatEventTimes, formatVenueAddress, toRequestStatusView } from './status-view';

const START = '2026-09-26T21:00:00Z'; // 23:00 Amsterdam (CEST)
const END = '2026-09-27T03:00:00Z'; // 05:00 the next morning

const approved = {
  found: true,
  status: 'approved',
  full_name: 'Mila Jansen',
  plus_ones: 4,
  event_name: 'Saturday Sessions',
  starts_at: START,
  ends_at: END,
  approved_plus_ones: 2,
  decision_message: '  Happy birthday! Doors close at 01:00.  ',
  venue_address_line: 'Warmoesstraat 12',
  venue_postal_code: '1012 JD',
  venue_city: 'Amsterdam',
} as const;

describe('toRequestStatusView — not found stays neutral', () => {
  it.each([
    ['found:false', { found: false }],
    ['null', null],
    ['a string', 'nope'],
    ['found without a status', { found: true, event_name: 'X' }],
    ['found without an event name', { found: true, status: 'pending' }],
    ['an unknown status', { found: true, status: 'maybe', event_name: 'X' }],
  ])('%s renders as not-found', (_label, payload) => {
    expect(toRequestStatusView(payload)).toBeNull();
  });
});

describe('toRequestStatusView — approved', () => {
  it('shows the reduced count, the trimmed message, the address and the window', () => {
    const v = toRequestStatusView(approved);
    expect(v).toMatchObject({
      status: 'approved',
      fullName: 'Mila Jansen',
      plusOnes: 4,
      approvedPlusOnes: 2,
      eventName: 'Saturday Sessions',
      time: '23:00 to 05:00',
      address: 'Warmoesstraat 12, 1012 JD Amsterdam',
      message: 'Happy birthday! Doors close at 01:00.',
    });
    expect(v?.date).toBe(formatWeekdayDate(START));
  });

  it('carries the confirmed count as is, never above what was asked', () => {
    expect(toRequestStatusView({ ...approved, approved_plus_ones: 4 })?.approvedPlusOnes).toBe(4);
    expect(toRequestStatusView({ ...approved, approved_plus_ones: 9 })?.approvedPlusOnes).toBe(4);
  });

  it('a present-but-null count means nothing was confirmed for this token (a duplicate submission)', () => {
    expect(toRequestStatusView({ ...approved, approved_plus_ones: null })?.approvedPlusOnes).toBeNull();
  });

  it('a reduction to zero plus-ones is still a reduction', () => {
    expect(toRequestStatusView({ ...approved, approved_plus_ones: 0 })?.approvedPlusOnes).toBe(0);
  });

  it('a blank message is no message', () => {
    expect(toRequestStatusView({ ...approved, decision_message: ' \n ' })?.message).toBeNull();
  });

  it('keeps the message as plain text, markup and all (React escapes it)', () => {
    const v = toRequestStatusView({ ...approved, decision_message: '<img src=x onerror=alert(1)>' });
    expect(v?.message).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('toRequestStatusView — pending and denied never show approval-only fields', () => {
  it.each(['pending', 'denied'] as const)('%s drops the address, count and message even if sent', (status) => {
    const v = toRequestStatusView({ ...approved, status });
    expect(v).toMatchObject({ status, address: null, approvedPlusOnes: null, message: null });
    expect(v?.time).toBe('23:00 to 05:00');
  });
});

describe('toRequestStatusView — a payload from before the migration still renders', () => {
  it('only the original keys: no window end, no address, no reduction', () => {
    const v = toRequestStatusView({
      found: true,
      status: 'approved',
      full_name: 'Liam Smit',
      plus_ones: 2,
      event_name: 'FRENZY',
      starts_at: START,
    });
    // No `approved_plus_ones` key at all: that function never reduced, so the
    // whole party was approved (the page keeps saying "Party of 3").
    expect(v).toMatchObject({ time: 'From 23:00', address: null, approvedPlusOnes: 2, message: null, plusOnes: 2 });
  });
});

describe('formatEventTimes', () => {
  it('no start, no window', () => {
    expect(formatEventTimes(null, END)).toBe('');
    expect(formatEventTimes('not a date', END)).toBe('');
  });
  it('an end at or before the start is ignored', () => {
    expect(formatEventTimes(START, START)).toBe('From 23:00');
  });
  it('an event of a day or longer names the end date', () => {
    const end = '2026-09-28T03:00:00Z';
    expect(formatEventTimes(START, end)).toBe(`23:00 to ${formatWeekdayDate(end)} 05:00`);
  });
  it('never uses a dash', () => {
    expect(formatEventTimes(START, END)).not.toMatch(/[‒-―-]/);
  });
});

describe('formatVenueAddress', () => {
  it('joins what is there', () => {
    expect(formatVenueAddress('Warmoesstraat 12', null, 'Amsterdam')).toBe('Warmoesstraat 12, Amsterdam');
    expect(formatVenueAddress(null, '1012 JD', 'Amsterdam')).toBe('1012 JD Amsterdam');
    expect(formatVenueAddress('  ', '', null)).toBeNull();
  });
});
