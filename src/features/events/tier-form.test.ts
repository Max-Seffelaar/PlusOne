import { describe, expect, it } from 'vitest';
import { blankTierDraft, draftAliases, draftToWrite, maxBelowUsed, tierToDraft, type TierDraft } from './tier-form';

// The Guest tiers form's rules, shared by create and edit (z8uq9m0hw3, item 5).

const paidTier = { name: 'Guest', color: '#B5A6FF', max: 150, doorPrice: 10, vatPercent: 21, aliases: ['gl', 'guestlist'] };
const freeTier = { name: 'VIP', color: '#9DE0C0', max: null, doorPrice: 0, vatPercent: null, aliases: [] };

const draft = (patch: Partial<TierDraft>): TierDraft => ({ ...blankTierDraft('#B5A6FF'), name: 'Guest', ...patch });

describe('tierToDraft (edit prefill)', () => {
  it('prefills a paid tier: name, colour, max, euros and VAT', () => {
    expect(tierToDraft(paidTier)).toEqual({
      name: 'Guest',
      color: '#B5A6FF',
      kind: 'paid',
      max: '150',
      price: '10',
      vat: '21',
      aliasText: 'gl, guestlist',
    });
  });

  it('shows cents with two decimals', () => {
    expect(tierToDraft({ ...paidTier, doorPrice: 12.5 }).price).toBe('12.50');
  });

  it('prefills a free tier with no max and the suggested VAT for a later switch to paid', () => {
    expect(tierToDraft(freeTier)).toMatchObject({ kind: 'free', max: '', price: '', vat: '9' });
  });

  it('keeps a paid tier without stored VAT at no VAT (never quietly adds 9%)', () => {
    const d = tierToDraft({ ...paidTier, vatPercent: null });
    expect(d.vat).toBe('');
    const w = draftToWrite(d);
    expect(w.ok && w.value.vatPercent).toBeNull();
  });

  it('round-trips an unchanged tier to the same stored values', () => {
    const w = draftToWrite(tierToDraft(paidTier));
    expect(w).toEqual({
      ok: true,
      value: { name: 'Guest', color: '#B5A6FF', maxGuests: 150, doorPriceCents: 1000, vatPercent: 21 },
    });
  });
});

describe('draftToWrite', () => {
  it('requires a name', () => {
    expect(draftToWrite(draft({ name: '   ' }))).toEqual({ ok: false, error: 'name_required' });
  });

  it('writes a free tier with price and VAT explicitly cleared', () => {
    expect(draftToWrite(draft({ kind: 'free', price: '25', vat: '9' }))).toEqual({
      ok: true,
      value: { name: 'Guest', color: '#B5A6FF', maxGuests: null, doorPriceCents: null, vatPercent: null },
    });
  });

  it('turns euros (comma or dot) into cents', () => {
    const a = draftToWrite(draft({ kind: 'paid', price: '12,50', vat: '21' }));
    const b = draftToWrite(draft({ kind: 'paid', price: '12.5', vat: '21' }));
    expect(a.ok && a.value.doorPriceCents).toBe(1250);
    expect(b.ok && b.value.doorPriceCents).toBe(1250);
  });

  it('refuses a paid tier without a usable price', () => {
    expect(draftToWrite(draft({ kind: 'paid', price: '' }))).toEqual({ ok: false, error: 'paid_needs_price' });
    expect(draftToWrite(draft({ kind: 'paid', price: '0' }))).toEqual({ ok: false, error: 'paid_needs_price' });
    expect(draftToWrite(draft({ kind: 'paid', price: 'abc' }))).toEqual({ ok: false, error: 'paid_needs_price' });
  });

  it('treats an empty, zero, or unreadable max as no maximum', () => {
    for (const max of ['', '0', 'x']) {
      const w = draftToWrite(draft({ max }));
      expect(w.ok && w.value.maxGuests).toBeNull();
    }
    const w = draftToWrite(draft({ max: '40' }));
    expect(w.ok && w.value.maxGuests).toBe(40);
  });

  it('never carries aliases (an edit must leave stored aliases alone)', () => {
    const w = draftToWrite(tierToDraft(paidTier));
    expect(w.ok && 'aliases' in w.value).toBe(false);
  });
});

describe('maxBelowUsed', () => {
  it('warns when the new max is below what the tier already holds', () => {
    expect(maxBelowUsed({ max: '10' }, 24)).toBe(true);
  });

  it('is quiet at or above usage, and with no max', () => {
    expect(maxBelowUsed({ max: '24' }, 24)).toBe(false);
    expect(maxBelowUsed({ max: '30' }, 24)).toBe(false);
    expect(maxBelowUsed({ max: '' }, 24)).toBe(false);
  });
});

describe('draftAliases', () => {
  it('splits and trims the comma list', () => {
    expect(draftAliases({ aliasText: ' bs, prod ,, backstage' })).toEqual(['bs', 'prod', 'backstage']);
  });
});
