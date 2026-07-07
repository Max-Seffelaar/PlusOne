import { describe, expect, it } from 'vitest';
import { TIER_COLORS, allColorsUsed, nextAvailableColor, tierInk, tintTier } from './tier-colors';

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

describe('tierInk (door-pill + guest-pill ink guard)', () => {
  it('picks dark ink on the bright palette colors', () => {
    for (const c of TIER_COLORS) {
      // The whole palette is intentionally bright → dark text everywhere.
      expect(tierInk(c)).toBe('#0B0B0D');
    }
  });

  it('picks light ink on a dark custom hex', () => {
    expect(tierInk('#101010')).toBe('#FFFFFF');
    expect(tierInk('#222266')).toBe('#FFFFFF');
  });

  it('guards a malformed hex (defaults to dark ink)', () => {
    expect(tierInk('#abc')).toBe('#0B0B0D');
    expect(tierInk('')).toBe('#0B0B0D');
  });
});

describe('tintTier', () => {
  it('produces an rgba with the given alpha', () => {
    expect(tintTier('#B5A6FF', 0.14)).toBe('rgba(181, 166, 255, 0.14)');
  });

  it('falls back to grey on a malformed hex', () => {
    expect(tintTier('#xyz', 0.2)).toBe('rgba(142, 142, 147, 0.2)');
  });
});
