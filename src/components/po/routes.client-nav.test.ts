/**
 * Snelheid P2 finding 1: every po screen and tab navigates client-only
 * (`history.pushState`, no RSC round-trip); the door's URLs and anything outside
 * `/app` keep the router (door navigation stays out of this change, §4 taak 9).
 * Review #492: no duplicate entry for the URL already showing, a full load once
 * the session is gone, and one router pass per MIDDLEWARE_PASS_MS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScreenName } from './context';
import { MIDDLEWARE_PASS_MS, doorPath, isClientOnlyPath, navMode, screenPath, tabPath } from './routes';

// `satisfies` makes tsc fail when a ScreenName is added without a line here.
const SCREENS = {
  event: true, lijst: true, guest: true, contacten: true, contactprofile: true, rollen: true, import: true,
  quickadd: true, bulk: true, share: true, aanvragen: true, eventedit: true, tiers: true, crew: true,
  gebruikers: true, pastevent: true, venueswitch: true, venuesettings: true, venuecreate: true, profile: true,
  billing: true, allowance: true, stats: true, audit: true, adminsessions: true, templates: true,
  templateedit: true, links: true, promotion: true, platform: true, platformvenues: true, platformaudit: true,
  platformaccess: true, platformoverview: true, platformmail: true,
} satisfies Record<ScreenName, true>;

describe('isClientOnlyPath', () => {
  it('every po screen URL is client-only', () => {
    for (const name of Object.keys(SCREENS) as ScreenName[]) {
      for (const props of [{}, { id: 'x1', eventId: 'e1' }]) {
        const url = screenPath(name, props);
        expect(isClientOnlyPath(url), `${name} → ${url}`).toBe(true);
      }
    }
  });

  it('every tab except the door is client-only', () => {
    for (const tab of ['start', 'events', 'guests', 'meer'] as const) expect(isClientOnlyPath(tabPath(tab))).toBe(true);
  });

  it('door URLs keep the router (door navigation is out of scope), with a query or a fragment', () => {
    expect(isClientOnlyPath(doorPath())).toBe(false);
    expect(isClientOnlyPath(doorPath({ eventId: 'e1' }))).toBe(false);
    expect(isClientOnlyPath(doorPath({ seg: 'taken', eventId: 'e1', overlay: { kind: 'guest', id: 'g1' } }))).toBe(false);
    expect(isClientOnlyPath('/app/door#x')).toBe(false);
  });

  it('anything outside /app keeps the router', () => {
    for (const url of ['/door/e1', '/onboarding', '/login', '/apps', '/application', '/e/slug']) {
      expect(isClientOnlyPath(url), url).toBe(false);
    }
    expect(isClientOnlyPath('/app')).toBe(true);
    expect(isClientOnlyPath('/app?x=1')).toBe(true);
  });
});

describe('navMode (review #492)', () => {
  const ctx = { current: '/app/guests', sessionGone: false, msSinceRouterNav: 0 };
  it('the URL already showing is no navigation at all (no duplicate history entry)', () => {
    expect(navMode('/app/guests', ctx)).toBe('none');
  });
  it('a po screen is client-only', () => {
    expect(navMode('/app/contacts', ctx)).toBe('client');
  });
  it('the door and non-/app paths use the router', () => {
    expect(navMode('/app/door', ctx)).toBe('router');
    expect(navMode('/onboarding', ctx)).toBe('router');
  });
  it('a dead session makes the next po navigation a full load (middleware → /login)', () => {
    expect(navMode('/app/contacts', { ...ctx, sessionGone: true })).toBe('document');
  });
  it('one navigation per MIDDLEWARE_PASS_MS still goes through the router', () => {
    expect(navMode('/app/contacts', { ...ctx, msSinceRouterNav: MIDDLEWARE_PASS_MS - 1 })).toBe('client');
    expect(navMode('/app/contacts', { ...ctx, msSinceRouterNav: MIDDLEWARE_PASS_MS })).toBe('router');
  });
});

describe('app.tsx opts in with a null history state', () => {
  // Next syncs usePathname/useSearchParams only for a state WITHOUT `__NA`;
  // passing `window.history.state` (as the door does) would silently freeze them.
  it('pushes and replaces with `null`, never the current state', () => {
    const src = readFileSync(join(__dirname, 'app.tsx'), 'utf8');
    const navigateBody = src.slice(src.indexOf('const navigate = useCallback('), src.indexOf('const pushUrl = useCallback('));
    expect(navigateBody).toContain("window.history.pushState(null, '', url)");
    expect(navigateBody).toContain("window.history.replaceState(null, '', url)");
    expect(navigateBody).not.toMatch(/(push|replace)State\(window\.history\.state/);
  });
});
