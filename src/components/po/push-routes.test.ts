import { describe, expect, it } from 'vitest';
import { parsePushPayload } from '@/features/notifications/payload';
import { pushTargetPath } from './push-routes';
import { parseAppUrl } from './routes';

const V = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
const E = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f71';
const R = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f72';

// Exactly what push-dispatch puts in the FCM data map: every value a string.
const data = (kind: string, extra: Record<string, string> = {}) => ({ kind, venue_id: V, event_id: E, request_id: R, ...extra });

describe('push tap → route (N5)', () => {
  it.each([
    ['quota_request_created', `/app/requests/quota?event=${E}`, 'quota'],
    ['guest_request_created', `/app/requests?event=${E}`, undefined],
    ['quota_request_decided', `/app/requests/quota?event=${E}`, 'quota'],
  ])('%s → %s', (kind, path, tab) => {
    const p = parsePushPayload(data(kind, kind === 'quota_request_decided' ? { status: 'approved' } : {}));
    expect(p).not.toBeNull();
    const url = pushTargetPath(p!);
    expect(url).toBe(path);
    // The URL resolves to the Requests screen for that event (G1 round trip).
    const [pathname, qs] = url.split('?');
    expect(parseAppUrl(pathname, new URLSearchParams(qs))).toEqual({ kind: 'screen', name: 'aanvragen', props: { id: E, tab } });
  });

  it('carries FCM/Android extras through without caring (google.* keys, collapse_key)', () => {
    expect(parsePushPayload({ ...data('guest_request_created'), 'google.sent_time': '1', collapse_key: 'x' })).toEqual({
      kind: 'guest_request_created',
      venueId: V,
      eventId: E,
    });
  });

  it.each([
    ['unknown kind', data('event_reminder')],
    ['missing event', { kind: 'guest_request_created', venue_id: V }],
    ['non-uuid event (path injection)', data('guest_request_created', { event_id: '../../platform' })],
    ['non-uuid venue', data('guest_request_created', { venue_id: 'x' })],
    ['empty', {}],
    ['not an object', 'guest_request_created'],
    ['null', null],
  ])('ignores %s', (_label, raw) => {
    expect(parsePushPayload(raw)).toBeNull();
  });
});
