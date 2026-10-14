/**
 * Max people (z8uq9m5m8g, decision Max 2026-10-14): empty and 0 both mean
 * "no max" (null) in the form and in the action schemas; 1..100 000 is a cap;
 * a negative number, a fraction or anything over 100 000 is refused with the
 * field message. The column's CHECK (> 0) never sees a 0.
 */
import { describe, it, expect } from 'vitest';
import { parseMaxHeads } from './shared';
import { createRequestLinkSchema, updateRequestLinkSchema } from '@/features/links/schemas';
import { t } from '@/lib/i18n';

const UUID = '00000000-0000-7000-8000-000000000001';

describe('parseMaxHeads (the form)', () => {
  it('empty → no max (null)', () => expect(parseMaxHeads('')).toEqual({ ok: true, value: null }));
  it('whitespace → no max (null)', () => expect(parseMaxHeads('  ')).toEqual({ ok: true, value: null }));
  it('0 → no max (null), not an error', () => expect(parseMaxHeads('0')).toEqual({ ok: true, value: null }));
  it('1 and 100 000 are caps', () => {
    expect(parseMaxHeads('1')).toEqual({ ok: true, value: 1 });
    expect(parseMaxHeads('100000')).toEqual({ ok: true, value: 100_000 });
  });
  it('over 100 000, negative or fractional is refused', () => {
    expect(parseMaxHeads('100001')).toEqual({ ok: false });
    expect(parseMaxHeads('-3')).toEqual({ ok: false });
    expect(parseMaxHeads('2.5')).toEqual({ ok: false });
  });
});

describe('the action schemas', () => {
  const create = (maxHeadcount: unknown) =>
    createRequestLinkSchema.safeParse({ eventId: UUID, label: 'Insta', slugBase: 'insta', maxHeadcount });

  it('create: 0 → null (no max), omitted stays omitted', () => {
    const zero = create(0);
    expect(zero.success && zero.data.maxHeadcount).toBeNull();
    const none = create(undefined);
    expect(none.success && none.data.maxHeadcount).toBeUndefined();
  });

  it('update: 0 → null (clears the cap), null stays null', () => {
    const zero = updateRequestLinkSchema.safeParse({ linkId: UUID, maxHeadcount: 0 });
    expect(zero.success && zero.data.maxHeadcount).toBeNull();
    const cleared = updateRequestLinkSchema.safeParse({ linkId: UUID, maxHeadcount: null });
    expect(cleared.success && cleared.data.maxHeadcount).toBeNull();
  });

  it('over 100 000, negative or fractional: the field message', () => {
    for (const v of [100_001, -1, 2.5]) {
      const r = create(v);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ['maxHeadcount'], message: t.links.errMaxHeadsRange });
    }
  });
});
