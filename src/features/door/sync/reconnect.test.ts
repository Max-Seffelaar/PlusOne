import { describe, expect, it } from 'vitest';
import { shouldRefetchOnStatus, type ChannelStatus } from './reconnect';

describe('shouldRefetchOnStatus', () => {
  const cases: Array<{ prev: ChannelStatus | null; next: ChannelStatus; expected: boolean; why: string }> = [
    { prev: null, next: 'SUBSCRIBED', expected: false, why: 'first connect must not double-fire (mount effect synced)' },
    { prev: 'SUBSCRIBED', next: 'SUBSCRIBED', expected: false, why: 'steady SUBSCRIBED is not a reconnect' },
    { prev: 'CHANNEL_ERROR', next: 'SUBSCRIBED', expected: true, why: 'resubscribe after a channel error → heal the gap' },
    { prev: 'TIMED_OUT', next: 'SUBSCRIBED', expected: true, why: 'resubscribe after a timeout → heal the gap' },
    { prev: 'CLOSED', next: 'SUBSCRIBED', expected: true, why: 'resubscribe after a close/reconnect → heal the gap' },
    { prev: 'SUBSCRIBED', next: 'CLOSED', expected: false, why: 'a drop itself never triggers a refetch' },
    { prev: 'SUBSCRIBED', next: 'CHANNEL_ERROR', expected: false, why: 'a drop itself never triggers a refetch' },
    { prev: 'SUBSCRIBED', next: 'TIMED_OUT', expected: false, why: 'a drop itself never triggers a refetch' },
    { prev: null, next: 'CHANNEL_ERROR', expected: false, why: 'an error on first connect is not a refetch' },
  ];

  for (const { prev, next, expected, why } of cases) {
    it(`${prev ?? 'null'} → ${next} = ${expected} (${why})`, () => {
      expect(shouldRefetchOnStatus(prev, next)).toBe(expected);
    });
  }
});
