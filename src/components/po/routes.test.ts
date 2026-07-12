import { describe, expect, it } from 'vitest';
import type { ScreenName, ScreenProps } from './context';
import { doorPath, parseAppUrl, screenPath, tabPath, type DoorOverlayState, type DoorSeg } from './routes';

/** Split a built URL into the (pathname, search) shape `parseAppUrl` expects —
 *  mirrors how `usePathname()`/`useSearchParams()` present a live route. */
function split(url: string): { pathname: string; search: URLSearchParams } {
  const [pathname, qs = ''] = url.split('?');
  return { pathname, search: new URLSearchParams(qs) };
}

describe('routes: screenPath ↔ parseAppUrl round-trip', () => {
  const cases: Array<[ScreenName, ScreenProps]> = [
    ['event', { id: 'e1' }],
    ['eventedit', { isNew: true }],
    ['eventedit', { id: 'e1' }],
    ['lijst', { id: 'e1' }],
    ['tiers', { id: 'e1' }],
    ['crew', { id: 'e1' }],
    ['allowance', {}],
    ['links', { id: 'e1' }],
    ['quickadd', { id: 'e1' }],
    ['quickadd', {}],
    ['bulk', { id: 'e1' }],
    ['bulk', {}],
    ['pastevent', { id: 'e1' }],
    ['guest', { id: 'g1' }],
    ['guest', { id: 'g1', eventId: 'e1' }],
    ['contacten', {}],
    ['contacten', { id: 'e1' }],
    ['contactprofile', { id: 'c1' }],
    ['import', {}],
    ['rollen', {}],
    ['aanvragen', {}],
    ['aanvragen', { id: 'e1' }],
    ['aanvragen', { tab: 'quota' }],
    ['aanvragen', { id: 'e1', tab: 'quota' }],
    ['gebruikers', {}],
    ['venueswitch', {}],
    ['venuesettings', {}],
    ['venuecreate', {}],
    ['profile', {}],
    ['billing', {}],
    ['stats', {}],
    ['audit', {}],
    ['audit', { id: 'e1' }],
    ['adminsessions', {}],
    ['templates', {}],
    ['templateedit', { isNew: true }],
    ['templateedit', { id: 't1' }],
    ['influencers', {}],
    ['promo', {}],
  ];

  for (const [name, props] of cases) {
    it(`${name} ${JSON.stringify(props)}`, () => {
      const url = screenPath(name, props);
      const { pathname, search } = split(url);
      const parsed = parseAppUrl(pathname, search);
      expect(parsed.kind).toBe('screen');
      if (parsed.kind === 'screen') {
        expect(parsed.name).toBe(name);
        expect(parsed.props).toEqual(props);
      }
    });
  }
});

describe('routes: tabPath ↔ parseAppUrl round-trip', () => {
  const tabs: Array<Exclude<Parameters<typeof tabPath>[0], never>> = ['start', 'events', 'guests', 'meer'];

  for (const tab of tabs) {
    it(tab, () => {
      const { pathname, search } = split(tabPath(tab));
      expect(parseAppUrl(pathname, search)).toEqual({ kind: 'tab', tab });
    });
  }
});

describe('routes: doorPath ↔ parseAppUrl round-trip', () => {
  const cases: Array<{ seg?: DoorSeg; eventId?: string | null; overlay?: DoorOverlayState }> = [
    {},
    { seg: 'taken' },
    { eventId: 'e1' },
    { seg: 'taken', eventId: 'e1' },
    { overlay: { kind: 'add' } },
    { overlay: { kind: 'guest', id: 'g1' } },
    { seg: 'taken', eventId: 'e1', overlay: { kind: 'guest', id: 'g1' } },
  ];

  for (const opts of cases) {
    it(JSON.stringify(opts), () => {
      const { pathname, search } = split(doorPath(opts));
      const parsed = parseAppUrl(pathname, search);
      expect(parsed).toEqual({
        kind: 'door',
        seg: opts.seg ?? 'deur',
        eventId: opts.eventId ?? null,
        overlay: opts.overlay ?? null,
      });
    });
  }
});

describe('routes: unrecognized path falls back to Start', () => {
  it('falls back rather than throwing', () => {
    expect(parseAppUrl('/app/totally/unknown/path', new URLSearchParams())).toEqual({ kind: 'tab', tab: 'start' });
  });
});

describe('routes: aanvragen tab:"landing" normalizes to the default (no explicit segment)', () => {
  // 'landing' is aanvragen's own internal default (approvals.tsx: `initialTab ??
  // 'landing'`) — there is no URL segment for it (only /quota is explicit), so
  // per this module's invariant an explicit {tab:'landing'} must build the exact
  // same URL as {} and cannot itself survive the round trip (that would require
  // one URL to decode to two different prop shapes). Callers must omit `tab`
  // rather than pass 'landing' explicitly (see home.tsx call sites).
  it('screenPath treats tab:"landing" the same as omitted', () => {
    expect(screenPath('aanvragen', { tab: 'landing' })).toBe(screenPath('aanvragen', {}));
    expect(screenPath('aanvragen', { id: 'e1', tab: 'landing' })).toBe(screenPath('aanvragen', { id: 'e1' }));
  });
});
