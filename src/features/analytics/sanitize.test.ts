import { describe, expect, it } from 'vitest';
import { stripQueryAndHash, stripUrlProperties } from './sanitize';
import { isBannerRoute, isPublicAnalyticsRoute } from './public-routes';

describe('stripQueryAndHash', () => {
  it.each([
    ['https://app.plus-one.io/app/guests?q=Jan%20Jansen#row', 'https://app.plus-one.io/app/guests'],
    ['https://app.plus-one.io/s/secret-token?x=1', 'https://app.plus-one.io/s/secret-token'],
    ['https://app.plus-one.io/', 'https://app.plus-one.io/'],
    ['/relative/path?x=1#y', '/relative/path'],
    ['', ''],
  ])('%s → %s', (input, out) => {
    expect(stripQueryAndHash(input)).toBe(out);
  });
});

describe('stripUrlProperties', () => {
  it('strips every URL-shaped PostHog property and leaves the rest alone', () => {
    const out = stripUrlProperties({
      $current_url: 'https://app.plus-one.io/app/guests?q=name',
      $referrer: 'https://www.plus-one.io/?utm=x#y',
      $initial_referrer: 'https://x.test/a?b=c',
      $pathname: '/app?x=1',
      screen: 'guests?not-a-url',
      count: 3,
    });
    expect(out).toEqual({
      $current_url: 'https://app.plus-one.io/app/guests',
      $referrer: 'https://www.plus-one.io/',
      $initial_referrer: 'https://x.test/a',
      $pathname: '/app',
      screen: 'guests?not-a-url',
      count: 3,
    });
  });

  it('passes undefined through', () => {
    expect(stripUrlProperties(undefined)).toBeUndefined();
  });
});

describe('public routes', () => {
  it.each([
    ['/', true, true],
    ['/login', true, true],
    ['/e/club-vesper', true, false],
    ['/e', true, false],
    ['/app', false, false],
    ['/app/profile', false, false],
    ['/door/abc', false, false],
    ['/onboarding', false, false],
    ['/s/token', false, false],
    ['/r/link', false, false],
    ['/events', false, false],
    [null, false, false],
  ] as const)('%s: banner %s, public analytics %s', (path, banner, tracked) => {
    expect(isBannerRoute(path)).toBe(banner);
    expect(isPublicAnalyticsRoute(path)).toBe(tracked);
  });
});
