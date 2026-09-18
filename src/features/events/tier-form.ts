/**
 * The event tier form's draft (what the fields hold, all strings) and its
 * mapping to and from the stored tier. Pure, so the create AND edit paths of
 * the Guest tiers screen share one set of rules (z8uq9m0hw3, item 5) and the
 * rules are unit-tested without rendering a sheet.
 *
 * Money rules are unchanged from the original create form: the door price is
 * typed in euros (comma or dot) and stored in cents (#34, display only); VAT is
 * display-only (T3) and only travels with a paid tier, mirroring the DB's
 * guest_tiers_vat_requires_price constraint.
 *
 * Aliases are NOT part of the write: the create path adds them only while
 * TIER_ALIASES_UI is on, and the edit path never sends them, so stored aliases
 * survive an edit untouched.
 */
import type { Tier } from '@/lib/po/types';

export type TierKind = 'free' | 'paid';

export interface TierDraft {
  name: string;
  color: string;
  kind: TierKind;
  /** Max guests (people), '' = no maximum. */
  max: string;
  /** Door price in euros, as typed. */
  price: string;
  /** VAT %, as typed. */
  vat: string;
  /** Comma-separated aliases (only rendered while TIER_ALIASES_UI is on). */
  aliasText: string;
}

/** The VAT the form suggests for a paid tier (9% = the Dutch low rate). */
export const DEFAULT_VAT = '9';

export function blankTierDraft(color: string): TierDraft {
  return { name: '', color, kind: 'free', max: '', price: '', vat: DEFAULT_VAT, aliasText: '' };
}

/** Euros as the form shows them: whole amounts bare ("10"), cents with 2 decimals ("12.50"). */
function euroText(amount: number): string {
  return amount % 1 === 0 ? String(amount) : amount.toFixed(2);
}

/** Prefill the form from a stored tier (the edit sheet). */
export function tierToDraft(tier: Pick<Tier, 'name' | 'color' | 'max' | 'doorPrice' | 'vatPercent' | 'aliases'>): TierDraft {
  const paid = tier.doorPrice > 0;
  return {
    name: tier.name,
    color: tier.color,
    kind: paid ? 'paid' : 'free',
    max: tier.max ? String(tier.max) : '',
    price: paid ? euroText(tier.doorPrice) : '',
    // A paid tier shows exactly what is stored (empty = no VAT on record, so a
    // save doesn't quietly add 9%). A free tier suggests the default, like the
    // create form, for when the user switches it to paid.
    vat: paid ? (tier.vatPercent != null ? String(tier.vatPercent) : '') : DEFAULT_VAT,
    aliasText: tier.aliases.join(', '),
  };
}

/** The draft's max as a number, or null for "no maximum" / unreadable. */
export function draftMax(draft: Pick<TierDraft, 'max'>): number | null {
  const n = Number.parseInt(draft.max, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The fields both createTier and updateTier accept (aliases excluded, see top). */
export interface TierWrite {
  name: string;
  color: string;
  maxGuests: number | null;
  doorPriceCents: number | null;
  vatPercent: number | null;
}

export type TierDraftResult = { ok: true; value: TierWrite } | { ok: false; error: 'name_required' | 'paid_needs_price' };

/**
 * Draft → write payload. Every field is explicit (null clears), so an edit that
 * turns a paid tier free also clears its price and VAT in the same update.
 */
export function draftToWrite(draft: TierDraft): TierDraftResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: 'name_required' };
  const priceNum = Number.parseFloat(draft.price.replace(',', '.'));
  const doorPriceCents =
    draft.kind === 'paid' && draft.price.trim() && Number.isFinite(priceNum) && priceNum > 0
      ? Math.round(priceNum * 100)
      : null;
  if (draft.kind === 'paid' && doorPriceCents == null) return { ok: false, error: 'paid_needs_price' };
  const vatNum = Number.parseFloat(draft.vat.replace(',', '.'));
  const vatPercent = draft.kind === 'paid' && Number.isFinite(vatNum) ? vatNum : null;
  return {
    ok: true,
    value: { name, color: draft.color, maxGuests: draftMax(draft), doorPriceCents, vatPercent },
  };
}

/** Parse the alias field into a clean list (create path, TIER_ALIASES_UI only). */
export function draftAliases(draft: Pick<TierDraft, 'aliasText'>): string[] {
  return draft.aliasText
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * True when the typed max is below what the tier already holds. The backend
 * allows it (nobody is removed), but no one new fits on the tier until usage
 * drops back under the max, so the form warns instead of blocking.
 */
export function maxBelowUsed(draft: Pick<TierDraft, 'max'>, used: number): boolean {
  const max = draftMax(draft);
  return max !== null && max < used;
}
