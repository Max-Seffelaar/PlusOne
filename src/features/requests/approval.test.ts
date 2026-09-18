// z8uq9m0hw6 — the approve sheet's decision → action input.
import { describe, expect, it } from 'vitest';
import { approveGuestRequestSchema } from './schemas';
import { buildApproveInput, clampApprovedPlusOnes } from './approval';

const REQ = { id: '00000000-0000-7000-8000-00000000000a', eventId: '00000000-0000-7000-8000-00000000000c', plus: 4 };
const TIER = '00000000-0000-7000-8000-00000000000b';

describe('clampApprovedPlusOnes', () => {
  it('keeps a value inside 0..requested', () => {
    expect(clampApprovedPlusOnes(2, 4)).toBe(2);
    expect(clampApprovedPlusOnes(0, 4)).toBe(0);
    expect(clampApprovedPlusOnes(4, 4)).toBe(4);
  });
  it('never goes above the request or below zero', () => {
    expect(clampApprovedPlusOnes(5, 4)).toBe(4);
    expect(clampApprovedPlusOnes(-1, 4)).toBe(0);
  });
  it('rounds, and treats garbage as "as requested"', () => {
    expect(clampApprovedPlusOnes(1.6, 4)).toBe(2);
    expect(clampApprovedPlusOnes(Number.NaN, 4)).toBe(4);
  });
  it('a solo request has nothing to reduce', () => {
    expect(clampApprovedPlusOnes(3, 0)).toBe(0);
  });
});

describe('buildApproveInput', () => {
  it('as requested and no message: the plain 2-arg shape', () => {
    expect(buildApproveInput(REQ, { tierId: TIER, plusOnes: 4, message: '' })).toEqual({
      requestId: REQ.id,
      tierId: TIER,
      eventId: REQ.eventId,
    });
  });

  it('a reduction carries the approved count, a note carries the trimmed text', () => {
    expect(buildApproveInput(REQ, { tierId: TIER, plusOnes: 2, message: '  See you at 23:00.\n' })).toEqual({
      requestId: REQ.id,
      tierId: TIER,
      eventId: REQ.eventId,
      plusOnes: 2,
      message: 'See you at 23:00.',
    });
  });

  it('zero plus-ones is a reduction too', () => {
    expect(buildApproveInput(REQ, { tierId: TIER, plusOnes: 0, message: ' ' })).toMatchObject({ plusOnes: 0 });
    expect(buildApproveInput(REQ, { tierId: TIER, plusOnes: 0, message: ' ' })).not.toHaveProperty('message');
  });

  it('a stepper value above the request is clamped, so it is never sent', () => {
    expect(buildApproveInput(REQ, { tierId: TIER, plusOnes: 9, message: '' })).not.toHaveProperty('plusOnes');
  });

  it('whatever it builds passes the action schema', () => {
    const input = buildApproveInput(REQ, { tierId: TIER, plusOnes: 1, message: 'x'.repeat(280) });
    expect(approveGuestRequestSchema.safeParse(input).success).toBe(true);
  });
});
