import { describe, expect, it } from 'vitest';
import { FEATURE_GRAPHIC, STORE_SETS, STORE_SHOTS, shotFile } from '../e2e/store/sets';

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*(\.png)?$/;

describe('store screenshot names (hyphens only, human readable)', () => {
  it('every set name matches', () => {
    for (const s of STORE_SETS) expect(s.name, s.name).toMatch(NAME);
  });
  it('every generated screen file name matches', () => {
    for (const shot of Object.values(STORE_SHOTS)) expect(shotFile(shot), shotFile(shot)).toMatch(NAME);
  });
  it('the feature graphic folder and file match', () => {
    expect(FEATURE_GRAPHIC.name).toMatch(NAME);
    expect(FEATURE_GRAPHIC.file).toMatch(NAME);
  });
  it('uses the agreed names', () => {
    expect(STORE_SETS.map((s) => s.name)).toEqual([
      'play-phone',
      'play-tablet-7-inch',
      'play-tablet-10-inch',
      'apple-iphone-6-9-inch',
      'apple-ipad-13-inch',
      'apple-ipad-13-inch-landscape',
    ]);
    expect(Object.values(STORE_SHOTS).map(shotFile)).toEqual([
      '01-home.png',
      '02-guest-list.png',
      '03-door-check-in.png',
      '04-requests.png',
      '05-stats.png',
    ]);
    expect(FEATURE_GRAPHIC.file).toBe('play-feature-graphic.png');
  });
});
