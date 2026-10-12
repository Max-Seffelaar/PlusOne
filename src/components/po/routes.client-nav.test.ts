/**
 * Snelheid P2 finding 1: every po screen and tab navigates client-only
 * (`history.pushState`, no RSC round-trip); the door's URLs and anything outside
 * `/app` keep the router (door navigation stays out of this change, §4 taak 9).
 */
import { describe, expect, it } from 'vitest';
import type { ScreenName } from './context';
import { doorPath, isClientOnlyPath, screenPath, tabPath } from './routes';

const SCREENS: ScreenName[] = [
  'event', 'lijst', 'guest', 'contacten', 'contactprofile', 'rollen', 'import', 'quickadd', 'bulk', 'share',
  'aanvragen', 'eventedit', 'tiers', 'crew', 'gebruikers', 'pastevent', 'venueswitch', 'venuesettings',
  'venuecreate', 'profile', 'billing', 'allowance', 'stats', 'audit', 'adminsessions', 'templates',
  'templateedit', 'links', 'promotion', 'platform', 'platformvenues', 'platformaudit', 'platformaccess',
  'platformoverview',
];

describe('isClientOnlyPath', () => {
  it('every po screen URL is client-only', () => {
    for (const name of SCREENS) {
      const url = screenPath(name, { id: 'x1', eventId: 'e1' });
      expect(isClientOnlyPath(url), `${name} → ${url}`).toBe(url.startsWith('/app') && !url.startsWith('/app/door'));
      expect(url.startsWith('/app/door'), `${name} must not be a door URL`).toBe(false);
    }
  });

  it('every tab except the door is client-only', () => {
    for (const tab of ['start', 'events', 'guests', 'meer'] as const) expect(isClientOnlyPath(tabPath(tab))).toBe(true);
  });

  it('door URLs keep the router (door navigation is out of scope)', () => {
    expect(isClientOnlyPath(doorPath())).toBe(false);
    expect(isClientOnlyPath(doorPath({ eventId: 'e1' }))).toBe(false);
    expect(isClientOnlyPath(doorPath({ seg: 'taken', eventId: 'e1', overlay: { kind: 'guest', id: 'g1' } }))).toBe(false);
  });

  it('anything outside /app keeps the router', () => {
    for (const url of ['/door/e1', '/onboarding', '/login', '/apps', '/application', '/e/slug']) {
      expect(isClientOnlyPath(url), url).toBe(false);
    }
    expect(isClientOnlyPath('/app')).toBe(true);
    expect(isClientOnlyPath('/app?x=1')).toBe(true);
  });
});
