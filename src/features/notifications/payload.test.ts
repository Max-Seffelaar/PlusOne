import { describe, expect, it } from 'vitest';
import { parsePushPayload } from './payload';

const V = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
const E = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f71';
// As FCM delivers it: every value a string.
const data = (extra: Record<string, string> = {}) => ({ kind: 'guest_request_created', venue_id: V, event_id: E, ...extra });

describe('push payload — hourly digest (N1)', () => {
  it('carries the bundled count', () => {
    expect(parsePushPayload(data({ count: '20' }))).toEqual({ kind: 'guest_request_created', venueId: V, eventId: E, count: 20 });
  });

  it('leaves a single request without a count', () => {
    expect(parsePushPayload(data())).toEqual({ kind: 'guest_request_created', venueId: V, eventId: E });
  });

  it.each([['1'], ['abc'], ['-3'], ['2.5']])('drops an unusable count (%s) but keeps the tap', (count) => {
    expect(parsePushPayload(data({ count }))).toEqual({ kind: 'guest_request_created', venueId: V, eventId: E });
  });
});
