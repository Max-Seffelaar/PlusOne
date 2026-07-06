import { describe, expect, it } from 'vitest';
import { TIER_COLORS, allColorsUsed, nextAvailableColor } from './tier-colors';

describe('nextAvailableColor', () => {
  it('returns the first palette color when none are used', () => {
    expect(nextAvailableColor([])).toBe(TIER_COLORS[0]);
  });

  it('skips colors already in use', () => {
    expect(nextAvailableColor([TIER_COLORS[0]])).toBe(TIER_COLORS[1]);
    expect(nextAvailableColor([TIER_COLORS[0], TIER_COLORS[1]])).toBe(TIER_COLORS[2]);
  });

  it('ignores unrelated colors not in the palette', () => {
    expect(nextAvailableColor(['#123456'])).toBe(TIER_COLORS[0]);
  });

  it('falls back to the first color once every palette color is used', () => {
    expect(nextAvailableColor([...TIER_COLORS])).toBe(TIER_COLORS[0]);
  });
});

describe('allColorsUsed', () => {
  it('is false while colors remain', () => {
    expect(allColorsUsed([TIER_COLORS[0]])).toBe(false);
  });

  it('is true once every palette color is used', () => {
    expect(allColorsUsed([...TIER_COLORS])).toBe(true);
  });

  it('is true even with extra unrelated colors mixed in, as long as the palette is covered', () => {
    expect(allColorsUsed([...TIER_COLORS, '#123456'])).toBe(true);
  });
});
