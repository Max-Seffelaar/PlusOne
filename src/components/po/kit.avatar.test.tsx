// @vitest-environment jsdom
/**
 * `Avatar`'s tier-colour fill (ADE round, item I).
 *
 * The bug this replaces was silent: every guest list passed
 * `accent={role === 'VIP'}`, which painted a lavender bubble for any tier whose
 * NAME looked VIP-ish, regardless of the tier's real colour (the fixture VIP
 * tier is mint). So the assertions below pin the two things that make the new
 * prop trustworthy: the fill is the colour you passed, and the ink is chosen by
 * luminance rather than assumed dark — a venue can pick a near-black custom
 * tier colour, and dark-on-dark initials would be invisible with nothing red.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { tierInk, tintTier } from '@/lib/po/tier-colors';
import { Avatar } from './kit';

const MINT = '#9DE0C0';
const NEAR_BLACK = '#101014';

function bubble(name: string): HTMLElement {
  return screen.getByText(name);
}

describe('Avatar', () => {
  it('renders the initials of the first two words', () => {
    render(<Avatar name="Juri Braakman de Wit" />);
    expect(bubble('JB')).toBeTruthy();
  });

  it('fills with the tier colour and picks dark ink for a light tier', () => {
    render(<Avatar name="Noor de Wit" color={MINT} />);
    const el = bubble('ND');
    expect(el.style.background).toBe('rgb(157, 224, 192)'); // #9DE0C0
    expect(el.style.color).toBe('rgb(11, 11, 13)'); // tierInk(mint) = #0B0B0D
    expect(tierInk(MINT)).toBe('#0B0B0D');
  });

  it('picks white ink for a dark custom tier colour (contrast, not assumption)', () => {
    render(<Avatar name="Sem Aaltink" color={NEAR_BLACK} />);
    expect(bubble('SA').style.color).toBe('rgb(255, 255, 255)');
    expect(tierInk(NEAR_BLACK)).toBe('#FFFFFF');
  });

  it('dims to the door tint + white ink for a guest who is already inside', () => {
    render(<Avatar name="Lucas van Os" color={MINT} dim />);
    const el = bubble('LV');
    expect(el.style.background).toBe(tintTier(MINT, 0.14));
    expect(el.style.color).toBe('rgb(255, 255, 255)');
  });

  it('drops the border when a tier colour is set, so the fill reads as one chip', () => {
    render(<Avatar name="Mila Jansen" color={MINT} />);
    expect(bubble('MJ').className).toContain('border-transparent');
  });

  it('keeps `accent` for non-guest uses, and `color` wins over it', () => {
    const { unmount } = render(<Avatar name="Club Nacht" accent />);
    const accented = bubble('CN');
    expect(accented.className).toContain('bg-acc');
    expect(accented.style.background).toBe('');
    unmount();

    render(<Avatar name="Club Nacht" accent color={MINT} />);
    const coloured = bubble('CN');
    expect(coloured.className).not.toContain('bg-acc');
    expect(coloured.style.background).toBe('rgb(157, 224, 192)');
  });

  it('leaves the neutral fill to CSS when no colour is given', () => {
    render(<Avatar name="Tess Bakker" />);
    const el = bubble('TB');
    expect(el.className).toContain('bg-elev2');
    expect(el.style.background).toBe('');
    expect(el.style.color).toBe('');
  });
});
