import { describe, expect, it } from 'vitest';
import { ADE_TRIAL_END, adeOfferOpen } from './ade';

// The client copy of the ADE date must match the migration's
// timestamptz '2026-10-27 00:00:00 Europe/Amsterdam' (CET, after the
// 25 October clock change).
describe('ADE trial offer (z8uq9m2vg5)', () => {
  it('ends at 27 Oct 2026 00:00 Amsterdam = 26 Oct 23:00 UTC', () => {
    expect(ADE_TRIAL_END.toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('is offered before that moment and not from it on', () => {
    expect(adeOfferOpen(new Date('2026-10-08T12:00:00Z'))).toBe(true);
    expect(adeOfferOpen(new Date('2026-10-26T22:59:59Z'))).toBe(true);
    expect(adeOfferOpen(new Date('2026-10-26T23:00:00Z'))).toBe(false);
    expect(adeOfferOpen(new Date('2026-11-01T00:00:00Z'))).toBe(false);
  });
});
