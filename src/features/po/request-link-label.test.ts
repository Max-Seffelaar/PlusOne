/**
 * The Requests inbox names the link every request came through (z8uq9m0hw4):
 * the event's default link as "Standard link", a custom one as
 * "via {influencer or label}". It only stays silent when the link genuinely
 * can't be named, so a row never claims a link it didn't come through.
 */
import { describe, expect, it } from 'vitest';
import { requestLinkLabel } from './format';

describe('requestLinkLabel', () => {
  it('names the default link "Standard link"', () => {
    expect(requestLinkLabel({ viaStandard: true, viaLabel: null })).toBe('Standard link');
  });

  it('keeps "via {label}" for a custom link or influencer', () => {
    expect(requestLinkLabel({ viaStandard: false, viaLabel: 'Jayden Promo' })).toBe('via Jayden Promo');
  });

  it('prefers the default flag over a stray label', () => {
    expect(requestLinkLabel({ viaStandard: true, viaLabel: 'Old label' })).toBe('Standard link');
  });

  it('returns null when the link cannot be named (no link, or one RLS hides)', () => {
    expect(requestLinkLabel({ viaStandard: false, viaLabel: null })).toBeNull();
  });
});
