// z8uq9m0hw6 — the approve sheet's decision → action input.
import { describe, expect, it } from 'vitest';
import { approveGuestRequestSchema, decideGuestRequestSchema } from './schemas';
import { buildApproveInput, buildDecideInput, buildDeclineInput, clampApprovedPlusOnes, placedPeople } from './approval';

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

// z8uq9m2vga — the split sheet's people-per-tier → the decide action's input.
describe('buildDecideInput', () => {
  const VIP = '00000000-0000-7000-8000-0000000000b1';
  const REG = '00000000-0000-7000-8000-0000000000b2';
  const R3 = { id: REQ.id, eventId: REQ.eventId, plus: 3 };

  it('everyone on one tier: a plain approval, nobody declined, no note', () => {
    expect(buildDecideInput(R3, { parts: [{ tierId: VIP, people: 4 }, { tierId: REG, people: 0 }], note: '  ' })).toEqual({
      requestId: R3.id,
      eventId: R3.eventId,
      approved: [{ tierId: VIP, plusOnes: 3 }],
      declined: 0,
    });
  });

  it('a split with a decline: 1 VIP, 2 on Regular (you +1), 1 declined, with the note', () => {
    const input = buildDecideInput(R3, {
      parts: [{ tierId: VIP, people: 1 }, { tierId: REG, people: 2 }],
      note: ' One less ',
    });
    expect(input).toEqual({
      requestId: R3.id,
      eventId: R3.eventId,
      approved: [{ tierId: VIP, plusOnes: 0 }, { tierId: REG, plusOnes: 1 }],
      declined: 1,
      note: 'One less',
    });
    expect(decideGuestRequestSchema.safeParse(input).success).toBe(true);
  });

  it('never places more than asked for: later parts are clamped to what is left', () => {
    const input = buildDecideInput(R3, { parts: [{ tierId: VIP, people: 3 }, { tierId: REG, people: 5 }], note: '' });
    expect(input.approved).toEqual([{ tierId: VIP, plusOnes: 2 }, { tierId: REG, plusOnes: 0 }]);
    expect(input.declined).toBe(0);
  });

  it('nobody placed: a whole decline, which the schema refuses without a note', () => {
    const input = buildDecideInput(R3, { parts: [{ tierId: VIP, people: 0 }], note: '' });
    expect(input).toMatchObject({ approved: [], declined: 4 });
    expect(decideGuestRequestSchema.safeParse(input).success).toBe(false);
    expect(decideGuestRequestSchema.safeParse(buildDeclineInput(R3, 'Full tonight')).success).toBe(true);
  });

  it('garbage counts are zero, never negative', () => {
    expect(placedPeople([{ tierId: VIP, people: -2 }, { tierId: REG, people: Number.NaN }], 4)).toBe(0);
    expect(placedPeople([{ tierId: VIP, people: 9 }], 4)).toBe(4);
  });
});
